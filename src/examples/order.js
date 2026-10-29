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
    const id = req.query.id as string;
    const rows = await this.db.query<Order>(`SELECT * FROM orders WHERE id = '${id}'`);
    res.json(rows[0]);
  }

  // Bug 2 (Security): any logged-in user can read anyone's order (no ownership check).
  async getOrderForUser(req: Request & { user?: { id: string } }, res: Response) {
    if (!req.user) return res.status(401).end();
    const rows = await this.db.query<Order>('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    res.json(rows[0]);
  }

  // Bug 3 (Logic): refund isn't awaited, and a refunded order can be refunded again.
  async refund(req: Request, res: Response) {
    const [order] = await this.db.query<Order>('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    this.payments.refund(order.id, order.amountCents);
    await this.db.query('UPDATE orders SET status = $1 WHERE id = $2', ['refunded', order.id]);
    res.json({ ok: true });
  }

  // Bug 4 (Logic): crashes when the order has no shipping address.
  shippingLabel(order: Order): string {
    return `${order.id} → ${order.shipping.city.toUpperCase()}, ${order.shipping?.country ?? ''}`;
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
