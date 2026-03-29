const createNotification = async (client, { userId, expenseId, title, message }) => {
  await client.query(
    `INSERT INTO notifications (user_id, expense_id, title, message) VALUES ($1, $2, $3, $4)`,
    [userId, expenseId || null, title, message]
  );
};

module.exports = { createNotification };
