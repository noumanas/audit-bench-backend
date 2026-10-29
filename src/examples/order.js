// Example orders controller used to test Audit Bench Ai reviews. Not wired into the app.

/**
 * @typedef {{ id: string, userId: string, status: 'pending' | 'paid' | 'refunded', amountCents: number,
 *   shipping?: { city: string, country: string } }} Order
 * @typedef {{ query: <T>(sql: string, params?: unknown[]) => Promise<T[]> }} Db
 * @typedef {{ refund: (orderId: string, amountCents: number) => Promise<void> }} Payments
 * @typedef {import('express').Request & { user?: { id: string, role?: string } }} AuthedRequest
 * @typedef {import('express').Response} Response
 */

export class OrdersController {
  /**
   * @param {Db} db
   * @param {Payments} payments
   */
  constructor(db, payments) {
    this.db = db;
    this.payments = payments;
  }

  /**
   * The signed-in user's order, by ?id=.
   *
   * @param {AuthedRequest} req @param {Response} res
   */
  async getOrder(req, res) {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const id = typeof req.query.id === 'string' ? req.query.id : '';
    if (!id) return res.status(400).json({ error: 'Missing order id' });
    const rows = await this.db.query('SELECT * FROM orders WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });
    return res.json(rows[0]);
  }

  /**
   * The signed-in user's order, by /orders/:id.
   *
   * @param {AuthedRequest} req @param {Response} res
   */
  async getUserOrder(req, res) {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const rows = await this.db.query('SELECT * FROM orders WHERE id = $1 AND user_id = $2', [
      req.params.id,
      req.user.id,
    ]);
    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });
    return res.json(rows[0]);
  }

  /**
   * Refunds a paid order, once. The status change is claimed atomically
   * before any money moves, so two requests at the same moment can't both
   * refund; if the payment provider fails, the order goes back to "paid".
   *
   * @param {AuthedRequest} req @param {Response} res
   */
  async refund(req, res) {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const isAdmin = req.user.role === 'admin';

    const [order] = await this.db.query(
      `UPDATE orders SET status = 'refunded'
       WHERE id = $1 AND status = 'paid' AND ($2::boolean OR user_id = $3)
       RETURNING *`,
      [req.params.id, isAdmin, req.user.id],
    );
    if (!order) {
      // Not found, not theirs, not paid, or already refunded: say which, without revealing other users' orders.
      const [existing] = await this.db.query('SELECT status FROM orders WHERE id = $1 AND ($2::boolean OR user_id = $3)', [
        req.params.id,
        isAdmin,
        req.user.id,
      ]);
      if (!existing) return res.status(404).json({ error: 'Order not found' });
      return res.status(409).json({ error: `Order can't be refunded (status: ${existing.status})` });
    }

    try {
      await this.payments.refund(order.id, order.amountCents);
    } catch {
      await this.db.query(`UPDATE orders SET status = 'paid' WHERE id = $1 AND status = 'refunded'`, [order.id]);
      return res.status(502).json({ error: 'The refund failed at the payment provider. Please try again.' });
    }
    return res.json({ ok: true });
  }

  /** @param {Order} order */
  shippingLabel(order) {
    if (!order.shipping?.city) return `${order.id} → (no shipping address)`;
    return `${order.id} → ${order.shipping.city.toUpperCase()}, ${order.shipping.country ?? ''}`;
  }

  /**
   * Total order value per user, in one query.
   *
   * @param {string[]} userIds
   * @returns {Promise<Record<string, number>>}
   */
  async totalsForUsers(userIds) {
    /** @type {Record<string, number>} */
    const totals = Object.fromEntries(userIds.map((id) => [id, 0]));
    if (userIds.length === 0) return totals;
    const rows = await this.db.query(
      'SELECT user_id, COALESCE(SUM(amount_cents), 0) AS total FROM orders WHERE user_id = ANY($1) GROUP BY user_id',
      [userIds],
    );
    for (const row of rows) totals[row.user_id] = Number(row.total);
    return totals;
  }
}
