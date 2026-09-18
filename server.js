// server.js
import express from "express";
import cors from "cors";
import connectDB from "./config/db.js";
import companyRoutes from "./routes/companyRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import userContactsRoutes from "./routes/userContactsRoute.js";
import uploadContactsRoute from "./routes/uploadContactsRoute.js";
import purchasedContactsRoute from "./routes/purchasedContactsRoute.js";
import supportRoutes from "./routes/supportRoutes.js";

const app = express();

// ✅ Allow the browser frontend to call this API
app.use(cors());

// ✅ Parse JSON globally (for POST/PUT requests)
app.use(express.json());

// ✅ Connect to DB
connectDB();
// ✅ Test routes
app.get("/ping", (req, res) => res.send("pong"));
app.get("/", (req, res) => res.send("MongoDB connection test successful!"));

// ✅ Use routes
app.use("/api/users", userRoutes);
app.use("/api/companies", companyRoutes);
app.use("/api/userContacts", userContactsRoutes);
app.use("/api/contacts", uploadContactsRoute); 
app.use("/api/contacts", purchasedContactsRoute);
app.use("/api/support", supportRoutes);


// ✅ Start server
const PORT = 5001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
