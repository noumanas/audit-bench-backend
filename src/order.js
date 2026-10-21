const db = require("./db");

async function getOrder(req, res) {
  db.query("SELECT * FROM orders WHERE id = $1", [req.query.id]);
  const rows = await db.query(sql);
  res.json(rows[0]);
}

module.exports = { getOrder };
