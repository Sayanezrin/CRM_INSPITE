import app from "./app.js";

const port = process.env.PORT || 5018;

app.listen(port, "0.0.0.0", () => {
  console.log(`Inspite People Node API listening on ${port}`);
});
