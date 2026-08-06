module.exports = (req, res, next) => {
  const adminKey = req.headers["x-admin-key"];
  
  if (!adminKey || adminKey !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: "Unauthorised: Invalid admin key" });
  }
  
  next();
};
