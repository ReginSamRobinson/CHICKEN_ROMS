import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/chicken";
const SECRET = process.env.JWT_SECRET || "chicken-local-secret";
const STAFF_PIN = process.env.STAFF_PIN || "1234";

// do not run in production with the default secret and PIN
if (process.env.NODE_ENV === "production" && !(process.env.JWT_SECRET && process.env.STAFF_PIN)) {
  console.log("Set JWT_SECRET and STAFF_PIN first.");
  process.exit(1);
}

const phoneRegex = /^\d{10}$/;
const timeSlots = ["12:00", "13:00", "14:00", "19:00", "20:00", "21:00"];

// ---------- models ----------
const MenuItem = mongoose.model("MenuItem", new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: String, enum: ["starter", "main", "dessert", "drink"], required: true },
  price: { type: Number, required: true, min: 0 },
  veg: { type: Boolean, default: false },
  available: { type: Boolean, default: true }
}));

const Order = mongoose.model("Order", new mongoose.Schema({
  customerPhone: { type: String, match: phoneRegex },
  orderType: { type: String, enum: ["dine-in", "takeaway"], required: true },
  tableNumber: { type: Number, min: 1, max: 12 },
  items: [{
    menuItem: { type: mongoose.Schema.Types.ObjectId, ref: "MenuItem" },
    quantity: { type: Number, min: 1 }
  }],
  total: Number,
  kitchenStatus: { type: String, enum: ["pending", "kitchen", "ready", "served"], default: "pending" },
  paymentStatus: { type: String, enum: ["unpaid", "paid"], default: "unpaid" },
  paymentMethod: { type: String, enum: ["cash", "card", "upi"] },
  createdAt: { type: Date, default: Date.now }
}));

const Reservation = mongoose.model("Reservation", new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true, match: phoneRegex },
  date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  timeSlot: { type: String, required: true },
  partySize: { type: Number, required: true, min: 1, max: 10 },
  tableNumber: { type: Number, min: 1, max: 12 },
  status: { type: String, enum: ["booked", "seated", "cancelled"], default: "booked" }
}));

// ---------- helpers ----------
// runs an async route and sends the error message back if something fails
const safe = (fn) => (req, res) => fn(req, res).catch((err) => res.status(400).json({ message: err.message }));

// only lets staff through (they need the token from /api/staff/login)
function checkStaff(req, res, next) {
  try {
    jwt.verify((req.headers.authorization || "").replace("Bearer ", ""), SECRET);
  } catch (err) {
    return res.status(401).json({ message: "Staff login required." });
  }
  next();
}

// ---------- staff login ----------
app.post("/api/staff/login", (req, res) => {
  if (req.body.pin !== STAFF_PIN) return res.status(401).json({ message: "Wrong PIN." });
  res.json({ token: jwt.sign({ role: "staff" }, SECRET, { expiresIn: "8h" }) });
});

// ---------- menu ----------
app.get("/api/menu", safe(async (req, res) => {
  res.json(await MenuItem.find().sort({ category: 1, name: 1 }));
}));

app.post("/api/menu", checkStaff, safe(async (req, res) => {
  res.status(201).json(await MenuItem.create(req.body));
}));

app.put("/api/menu/:id", checkStaff, safe(async (req, res) => {
  res.json(await MenuItem.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true }));
}));

app.delete("/api/menu/:id", checkStaff, safe(async (req, res) => {
  await MenuItem.findByIdAndDelete(req.params.id);
  res.json({ message: "Deleted." });
}));

// ---------- orders ----------
// anyone can place an order, the total is calculated here from the menu prices
app.post("/api/orders", safe(async (req, res) => {
  const { customerPhone, orderType, tableNumber, items } = req.body;
  if (customerPhone && !phoneRegex.test(customerPhone)) return res.status(400).json({ message: "Phone must have 10 digits." });
  if (orderType === "dine-in" && !tableNumber) return res.status(400).json({ message: "Choose a table." });
  if (!items || items.length === 0) return res.status(400).json({ message: "Add at least one item." });

  let total = 0;
  for (const item of items) {
    const dish = await MenuItem.findById(item.menuItem);
    if (!dish || !dish.available) return res.status(400).json({ message: "A dish is not available." });
    if (!Number.isInteger(item.quantity) || item.quantity < 1) return res.status(400).json({ message: "Quantity must be 1 or more." });
    total += dish.price * item.quantity;
  }

  const order = await Order.create({
    customerPhone,
    orderType,
    tableNumber: orderType === "dine-in" ? tableNumber : undefined,
    items,
    total
  });
  res.status(201).json(order);
}));

app.get("/api/orders/:id", safe(async (req, res) => {
  res.json(await Order.findById(req.params.id).populate("items.menuItem", "name price"));
}));

app.get("/api/orders", checkStaff, safe(async (req, res) => {
  res.json(await Order.find().populate("items.menuItem", "name price").sort({ createdAt: -1 }));
}));

// staff use this to change kitchenStatus, paymentStatus and paymentMethod
app.put("/api/orders/:id", checkStaff, safe(async (req, res) => {
  res.json(await Order.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true }));
}));

app.delete("/api/orders/:id", checkStaff, safe(async (req, res) => {
  await Order.findByIdAndDelete(req.params.id);
  res.json({ message: "Deleted." });
}));

// ---------- reservations ----------
app.post("/api/reservations", safe(async (req, res) => {
  const { name, phone, date, timeSlot, partySize } = req.body;
  if (!name || !timeSlots.includes(timeSlot)) return res.status(400).json({ message: "Fill in all the booking details." });
  if (date < new Date().toISOString().slice(0, 10)) return res.status(400).json({ message: "Choose today or a future date." });

  // each time slot only has room for 5 bookings
  const count = await Reservation.countDocuments({ date, timeSlot, status: { $ne: "cancelled" } });
  if (count >= 5) return res.status(409).json({ message: "That time is full. Please pick another one." });

  res.status(201).json(await Reservation.create({ name, phone, date, timeSlot, partySize }));
}));

app.get("/api/reservations/:id", safe(async (req, res) => {
  res.json(await Reservation.findById(req.params.id));
}));

app.get("/api/reservations", checkStaff, safe(async (req, res) => {
  res.json(await Reservation.find().sort({ date: 1, timeSlot: 1 }));
}));

app.put("/api/reservations/:id", checkStaff, safe(async (req, res) => {
  res.json(await Reservation.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true }));
}));

app.delete("/api/reservations/:id", checkStaff, safe(async (req, res) => {
  await Reservation.findByIdAndDelete(req.params.id);
  res.json({ message: "Deleted." });
}));

// ---------- customers (grouped by phone number) ----------
app.get("/api/customers", checkStaff, safe(async (req, res) => {
  res.json(await Order.aggregate([
    { $match: { customerPhone: { $ne: null } } },
    { $group: { _id: "$customerPhone", orderCount: { $sum: 1 }, totalSpent: { $sum: "$total" }, lastOrder: { $max: "$createdAt" } } }
  ]));
}));

// ---------- sample menu (npm run seed) ----------
async function seedMenu() {
  const dishes = [
    ["Crispy cauliflower", "starter", 250, true], ["Chicken wings", "starter", 350, false], ["Garlic flatbread", "starter", 180, true],
    ["Roast chicken plate", "main", 550, false], ["Smash burger", "main", 450, false], ["Mushroom pasta", "main", 400, true],
    ["Chicken curry", "main", 480, false], ["Margherita pizza", "main", 420, true], ["Chocolate tart", "dessert", 220, true],
    ["Vanilla ice cream", "dessert", 150, true], ["House lemonade", "drink", 120, true], ["Espresso", "drink", 100, true]
  ];
  await MenuItem.deleteMany({});
  await MenuItem.insertMany(dishes.map(([name, category, price, veg]) => ({ name, category, price, veg })));
  console.log("Added " + dishes.length + " dishes.");
}

mongoose.connect(MONGO_URI)
  .then(async () => {
    if (process.argv.includes("--seed")) {
      await seedMenu();
      process.exit();
    }
    app.listen(PORT, () => console.log("Server running on port " + PORT));
  })
  .catch((err) => console.log("MongoDB connection failed:", err.message));
