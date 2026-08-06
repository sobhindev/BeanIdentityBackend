require("dotenv").config();
const express = require("express");
const cors = require("cors");

const path = require("path");

const app = express();
const connectDB = require("./config/db");



app.use(cors("*"));
app.use(express.json());

app.use("/admin", express.static(path.join(__dirname, "public/admin")));
app.use("/api/returns", require("./routes/returns"));
app.use("/api/stories", require("./routes/stories"));
app.use("/api/quiz", require("./routes/quiz"));

app.get("/", (req, res) => {
  res.send("Returns Service Running 🚀");
});

const PORT = process.env.PORT || 5000;
connectDB();

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});