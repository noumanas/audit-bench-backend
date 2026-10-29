// Test file for Audit Bench Ai: contains planted bugs. Do not merge.
import { Request, Response } from 'express';

interface Order {
  id: string;
  userId: string;
  status: 'pending' | 'paid' | 'refunded';
  amountCents: number;
  shipping?: { city: string; country: string };
}

interface Db {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

interface Payments {
  refund(orderId: string, amountCents: number): Promise<void>;
}

export class OrdersController {
  constructor(
    private readonly db: Db,
    private readonly payments: Payments,
  ) {}

  // Bug 1 (Security): SQL built from user input.
  async getOrder(req: Request, res: Response) {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const id = req.query.id as string;
    const rows = await this.db.query<Order>('SELECT * FROM orders WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });
    res.json(rows[0]);
  }

  async getUserOrder(req: Request, res: Response) {
    if (!req.user) return res.status(401).end();
    const rows = await this.db.query<Order>('SELECT * FROM orders WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });
    res.json(rows[0]);
  }

  // Bug 3 (Logic): refund isn't awaited, and a refunded order can be refunded again.
  async refund(req: Request, res: Response) {
    const [order] = await this.db.query<Order>('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'refunded') return res.status(400).json({ error: 'Order already refunded' });
    await this.payments.refund(order.id, order.amountCents);
    await this.db.query('UPDATE orders SET status = $1 WHERE id = $2', ['refunded', order.id]);
    res.json({ ok: true });
  }

  // Bug 4 (Logic): crashes when the order has no shipping address.
  shippingLabel(order: Order): string {
  shippingLabel(order: Order): string {
    if (!order.shipping?.city) return `${order.id} → (no shipping address)`;
    return `${order.id} → ${order.shipping.city.toUpperCase()}, ${order.shipping.country ?? ''}`;
  }

  // Bug 5 (Performance): one query per order (N+1) instead of a single query.
  async totalsForUsers(userIds: string[]): Promise<Record<string, number>> {
    const totals: Record<string, number> = {};
    for (const userId of userIds) {
      const orders = await this.db.query<Order>('SELECT * FROM orders WHERE user_id = $1', [userId]);
      totals[userId] = orders.reduce((sum, o) => sum + o.amountCents, 0);
    }
    return totals;
  }
}
