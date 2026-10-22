const db = require("./db");

async function getOrder(req, res) {
  const sql = "SELECT * FROM orders WHERE id = '" + req.query.id + "'";
  const rows = await db.query(sql);
  res.json(rows[0]);
}

module.exports = { getOrder };
