import app from "./app.js";
import { getModels } from "./database.js";

const port = process.env.PORT || 5018;
 
app.listen(port, "0.0.0.0", () => {
  console.log(`Inspite People Node API listening on ${port}`);
  getModels()
    .then((models) => {
      if (!models) console.log("MongoDB not configured. Using JSON fallback storage.");
    })
    .catch((error) => {
      console.error("MongoDB connection failed:", error.message);
    });
});
