import { useEffect, useState } from "react";
import { BrowserRouter, Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import "./styles.css";

const categories = ["starter", "main", "dessert", "drink"];
const tables = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const timeSlots = ["12:00", "13:00", "14:00", "19:00", "20:00", "21:00"];
const today = new Date().toISOString().slice(0, 10);

const rupees = (amount) => "₹" + Number(amount || 0).toFixed(2);
const cartTotal = (cart) => cart.reduce((sum, line) => sum + line.price * line.quantity, 0);

// talk to the backend and return the json reply
async function api(path, method = "GET", body, token) {
  const res = await fetch("/api" + path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + (token || "") },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Something went wrong.");
  return data;
}

// add (change = 1) or remove (change = -1) one dish from a list of cart lines
function updateCart(cart, dish, change) {
  if (!cart.find((line) => line._id === dish._id)) return [...cart, { ...dish, quantity: 1 }];
  return cart
    .map((line) => (line._id === dish._id ? { ...line, quantity: line.quantity + change } : line))
    .filter((line) => line.quantity > 0);
}

// loads a list from the backend and gives back a send() function for changing things (staff pages)
function useList(path, token) {
  const [list, setList] = useState([]);
  const load = () => api(path, "GET", null, token).then(setList).catch((err) => alert(err.message));
  useEffect(() => {
    load();
  }, []);

  async function send(url, method, body) {
    try {
      await api(url, method, body, token);
      load();
    } catch (err) {
      alert(err.message);
    }
  }
  return [list, send];
}

// ---------- customer pages ----------

function Menu({ cart, setCart, orderType, setOrderType, table, setTable }) {
  const [menu, setMenu] = useState([]);
  const [category, setCategory] = useState("all");

  useEffect(() => {
    api("/menu").then(setMenu).catch((err) => alert(err.message));
  }, []);

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="hero-eyebrow">KITCHEN / ESTABLISHED 2024</p>
          <h1>Chicken, fire<br />&amp; good things.</h1>
          <p className="hero-tagline">Golden edges. Juicy middles. Made to order.</p>
        </div>
      </section>
      <div className="menu-page">
        <div>
          <h1>Our menu</h1>
          <div className="tabs">
            {["all", ...categories].map((name) => (
              <button key={name} className={category === name ? "active" : ""} onClick={() => setCategory(name)}>{name}</button>
            ))}
          </div>
          {menu.filter((dish) => dish.available && (category === "all" || dish.category === category)).map((dish) => (
            <div className="row" key={dish._id}>
              <span>{dish.veg ? "🟢" : "🔴"} {dish.name}</span>
              <span>{rupees(dish.price)} <button onClick={() => setCart(updateCart(cart, dish, 1))}>Add</button></span>
            </div>
          ))}
        </div>

        <div className="box cart">
          <h2>Your order</h2>
          {cart.length === 0 && <p>Nothing added yet.</p>}
          {cart.map((line) => (
            <div className="row" key={line._id}>
              <span>{line.quantity} × {line.name}</span>
              <span>
                {rupees(line.price * line.quantity)}{" "}
                <button onClick={() => setCart(updateCart(cart, line, -1))}>-</button>
                <button onClick={() => setCart(updateCart(cart, line, 1))}>+</button>
              </span>
            </div>
          ))}
          <select value={orderType} onChange={(e) => setOrderType(e.target.value)}>
            <option value="takeaway">Takeaway</option>
            <option value="dine-in">Dine in</option>
          </select>
          {orderType === "dine-in" && (
            <select value={table} onChange={(e) => setTable(e.target.value)}>
              <option value="">Choose table</option>
              {tables.map((number) => <option key={number}>{number}</option>)}
            </select>
          )}
          <h3>Total: {rupees(cartTotal(cart))}</h3>
          <Link className="button" to="/checkout">Checkout</Link>
        </div>
      </div>
    </>
  );
}

function Checkout({ cart, setCart, orderType, table }) {
  const [phone, setPhone] = useState("");
  const navigate = useNavigate();

  async function placeOrder(e) {
    e.preventDefault();
    try {
      const items = cart.map((line) => ({ menuItem: line._id, quantity: line.quantity }));
      const order = await api("/orders", "POST", { customerPhone: phone, orderType, tableNumber: table, items });
      setCart([]);
      navigate("/order/" + order._id);
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <form className="box small" onSubmit={placeOrder}>
      <Link to="/">← Menu</Link>
      <h1>Checkout</h1>
      <p>{orderType === "dine-in" ? "Dine in, table " + (table || "not chosen") : "Takeaway"}</p>
      <h3>Total: {rupees(cartTotal(cart))}</h3>
      <input required pattern="\d{10}" maxLength="10" placeholder="Phone number (10 digits)" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <button className="button">Place order</button>
    </form>
  );
}

function Receipt() {
  const { id } = useParams();
  const [order, setOrder] = useState(null);

  useEffect(() => {
    api("/orders/" + id).then(setOrder).catch((err) => alert(err.message));
  }, [id]);

  if (!order) return <div className="box small">Loading...</div>;
  return (
    <div className="box small">
      <h1>Thank you!</h1>
      <p>Order {order._id.slice(-6).toUpperCase()}</p>
      {order.items.map((line) => (
        <div className="row" key={line._id}>
          <span>{line.quantity} × {line.menuItem?.name}</span>
          <span>{rupees(line.menuItem?.price * line.quantity)}</span>
        </div>
      ))}
      <h3>Total: {rupees(order.total)}</h3>
      <Link to="/">Back to menu</Link>
    </div>
  );
}

function Reserve() {
  const [form, setForm] = useState({ name: "", phone: "", date: today, timeSlot: "12:00", partySize: 2 });
  const navigate = useNavigate();
  const change = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    try {
      const booking = await api("/reservations", "POST", form);
      navigate("/reservation/" + booking._id);
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <form className="box small" onSubmit={submit}>
      <h1>Book a table</h1>
      <input required name="name" placeholder="Name" value={form.name} onChange={change} />
      <input required name="phone" pattern="\d{10}" maxLength="10" placeholder="Phone (10 digits)" value={form.phone} onChange={change} />
      <input required type="date" name="date" min={today} value={form.date} onChange={change} />
      <select name="timeSlot" value={form.timeSlot} onChange={change}>
        {timeSlots.map((slot) => <option key={slot}>{slot}</option>)}
      </select>
      <select name="partySize" value={form.partySize} onChange={change}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((size) => <option key={size} value={size}>{size} guests</option>)}
      </select>
      <button className="button">Book table</button>
    </form>
  );
}

function ReservationDone() {
  const { id } = useParams();
  const [booking, setBooking] = useState(null);

  useEffect(() => {
    api("/reservations/" + id).then(setBooking).catch((err) => alert(err.message));
  }, [id]);

  if (!booking) return <div className="box small">Loading...</div>;
  return (
    <div className="box small">
      <h1>Table booked!</h1>
      <p>{booking.name}, {booking.partySize} guests</p>
      <p>{booking.date} at {booking.timeSlot}</p>
      <Link to="/">Back to menu</Link>
    </div>
  );
}

// ---------- staff pages ----------

function Orders({ token }) {
  const [orders, send] = useList("/orders", token);
  const [menu] = useList("/menu", token);
  const [draft, setDraft] = useState([]); // dishes for a new order
  const [orderType, setOrderType] = useState("takeaway");
  const [table, setTable] = useState("");
  const [phone, setPhone] = useState("");
  const [filter, setFilter] = useState("all");

  // what the next button does for each kitchen status: [new status, button text]
  const nextStep = { pending: ["kitchen", "Send to kitchen"], kitchen: ["ready", "Mark ready"], ready: ["served", "Mark served"] };

  async function newOrder() {
    const items = draft.map((line) => ({ menuItem: line._id, quantity: line.quantity }));
    await send("/orders", "POST", { customerPhone: phone || undefined, orderType, tableNumber: table, items });
    setDraft([]);
  }

  return (
    <>
      <h1>Orders</h1>
      <div className="staff-box">
        <h2>New order</h2>
        {menu.filter((dish) => dish.available).map((dish) => (
          <button key={dish._id} onClick={() => setDraft(updateCart(draft, dish, 1))}>{dish.name}</button>
        ))}
        <p>{draft.map((line) => line.quantity + " × " + line.name).join(", ") || "No dishes selected"}</p>
        <select value={orderType} onChange={(e) => setOrderType(e.target.value)}>
          <option value="takeaway">Takeaway</option>
          <option value="dine-in">Dine in</option>
        </select>
        {orderType === "dine-in" && (
          <select value={table} onChange={(e) => setTable(e.target.value)}>
            <option value="">Table</option>
            {tables.map((number) => <option key={number}>{number}</option>)}
          </select>
        )}
        <input placeholder="Phone (optional)" maxLength="10" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <button className="button" onClick={newOrder}>Send order</button>
      </div>

      <select value={filter} onChange={(e) => setFilter(e.target.value)}>
        {["all", "pending", "kitchen", "ready", "served"].map((status) => <option key={status}>{status}</option>)}
      </select>
      <div className="grid">
        {orders.filter((order) => filter === "all" || order.kitchenStatus === filter).map((order) => (
          <div className="ticket" key={order._id}>
            <h3>#{order._id.slice(-6).toUpperCase()} · {order.kitchenStatus}</h3>
            <p>{order.orderType}{order.tableNumber ? ", table " + order.tableNumber : ""}</p>
            {order.items.map((line) => <p key={line._id}>{line.quantity} × {line.menuItem?.name}</p>)}
            <b>{rupees(order.total)}</b>
            <p>{order.paymentStatus === "paid" ? "Paid by " + order.paymentMethod : "Unpaid"}</p>
            {nextStep[order.kitchenStatus] && (
              <button onClick={() => send("/orders/" + order._id, "PUT", { kitchenStatus: nextStep[order.kitchenStatus][0] })}>
                {nextStep[order.kitchenStatus][1]}
              </button>
            )}
            {order.paymentStatus === "unpaid" && ["cash", "card", "upi"].map((method) => (
              <button key={method} onClick={() => send("/orders/" + order._id, "PUT", { paymentStatus: "paid", paymentMethod: method })}>Pay {method}</button>
            ))}
            <button className="danger" onClick={() => window.confirm("Delete this order?") && send("/orders/" + order._id, "DELETE")}>Delete</button>
          </div>
        ))}
      </div>
    </>
  );
}

function Reservations({ token }) {
  const [bookings, send] = useList("/reservations", token);
  const [filter, setFilter] = useState("booked");

  return (
    <>
      <h1>Reservations</h1>
      {["booked", "seated", "cancelled", "all"].map((status) => (
        <button key={status} className={filter === status ? "active" : ""} onClick={() => setFilter(status)}>{status}</button>
      ))}
      {bookings.filter((b) => filter === "all" || b.status === filter).map((b) => (
        <div className="staff-box" key={b._id}>
          <b>{b.name}</b> · {b.phone} · {b.partySize} guests<br />
          {b.date} at {b.timeSlot} · {b.status}<br />
          <select value={b.tableNumber || ""} onChange={(e) => send("/reservations/" + b._id, "PUT", { tableNumber: e.target.value })}>
            <option value="">No table</option>
            {tables.map((number) => <option key={number}>{number}</option>)}
          </select>
          <button onClick={() => send("/reservations/" + b._id, "PUT", { status: "seated" })}>Seat</button>
          <button onClick={() => send("/reservations/" + b._id, "PUT", { status: "cancelled" })}>Cancel</button>
          <button className="danger" onClick={() => window.confirm("Delete reservation?") && send("/reservations/" + b._id, "DELETE")}>Delete</button>
        </div>
      ))}
    </>
  );
}

const emptyDish = { name: "", category: "main", price: "", veg: false, available: true };

function MenuPanel({ token }) {
  const [menu, send] = useList("/menu", token);
  const [form, setForm] = useState(emptyDish);
  const [editId, setEditId] = useState(null);

  const change = (e) => setForm({ ...form, [e.target.name]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  async function save(e) {
    e.preventDefault();
    await send(editId ? "/menu/" + editId : "/menu", editId ? "PUT" : "POST", form);
    setForm(emptyDish);
    setEditId(null);
  }

  function startEdit(dish) {
    const { name, category, price, veg, available } = dish;
    setForm({ name, category, price, veg, available });
    setEditId(dish._id);
  }

  return (
    <>
      <h1>Menu</h1>
      <form className="staff-box" onSubmit={save}>
        <h2>{editId ? "Edit dish" : "Add dish"}</h2>
        <input required name="name" placeholder="Dish name" value={form.name} onChange={change} />
        <select name="category" value={form.category} onChange={change}>
          {categories.map((name) => <option key={name}>{name}</option>)}
        </select>
        <input required type="number" min="0" name="price" placeholder="Price in rupees" value={form.price} onChange={change} />
        <label><input type="checkbox" name="veg" checked={form.veg} onChange={change} /> Veg</label>
        <label><input type="checkbox" name="available" checked={form.available} onChange={change} /> Available</label>
        <button className="button">Save</button>
      </form>
      {menu.map((dish) => (
        <div className="row" key={dish._id}>
          <span>{dish.name} · {rupees(dish.price)} · {dish.category} · {dish.available ? "available" : "sold out"}</span>
          <span>
            <button onClick={() => send("/menu/" + dish._id, "PUT", { available: !dish.available })}>Toggle</button>
            <button onClick={() => startEdit(dish)}>Edit</button>
            <button className="danger" onClick={() => window.confirm("Delete " + dish.name + "?") && send("/menu/" + dish._id, "DELETE")}>Delete</button>
          </span>
        </div>
      ))}
    </>
  );
}

function Customers({ token }) {
  const [customers] = useList("/customers", token);

  return (
    <>
      <h1>Customers</h1>
      <div className="grid">
        {customers.map((c) => (
          <div className="staff-box" key={c._id}>
            <h3>{c._id}</h3>
            <p>Orders: {c.orderCount}</p>
            <p>Total spent: {rupees(c.totalSpent)}</p>
            <p>Last visit: {new Date(c.lastOrder).toLocaleDateString()}</p>
          </div>
        ))}
      </div>
    </>
  );
}

const panels = { Orders, Reservations, Menu: MenuPanel, Customers };

function Staff() {
  const [token, setToken] = useState(""); // only kept in memory, so refreshing logs out
  const [pin, setPin] = useState("");
  const [panel, setPanel] = useState("Orders");

  async function login(e) {
    e.preventDefault();
    try {
      const data = await api("/staff/login", "POST", { pin });
      setToken(data.token);
    } catch (err) {
      alert(err.message);
    }
  }

  if (!token) {
    return (
      <form className="box small" onSubmit={login}>
        <h1>Staff login</h1>
        <input type="password" placeholder="Enter PIN" value={pin} onChange={(e) => setPin(e.target.value)} />
        <button className="button">Login</button>
      </form>
    );
  }

  const Panel = panels[panel];
  return (
    <div className="staff">
      <div className="sidebar">
        {Object.keys(panels).map((name) => (
          <button key={name} className={panel === name ? "active" : ""} onClick={() => setPanel(name)}>{name}</button>
        ))}
        <button onClick={() => setToken("")}>Logout</button>
      </div>
      <div className="staff-content"><Panel token={token} /></div>
    </div>
  );
}

// ---------- main app ----------
// the cart lives here so it is not lost when going between pages
export default function App() {
  const [cart, setCart] = useState([]);
  const [orderType, setOrderType] = useState("takeaway");
  const [table, setTable] = useState("");
  const shop = { cart, setCart, orderType, setOrderType, table, setTable };

  return (
    <BrowserRouter>
      <header>
        <Link to="/" className="brand">CHICKEN</Link>
        <nav><Link to="/reserve">Reserve</Link><Link to="/staff">Staff</Link></nav>
      </header>
      <Routes>
        <Route path="/" element={<Menu {...shop} />} />
        <Route path="/checkout" element={<Checkout {...shop} />} />
        <Route path="/order/:id" element={<Receipt />} />
        <Route path="/reserve" element={<Reserve />} />
        <Route path="/reservation/:id" element={<ReservationDone />} />
        <Route path="/staff" element={<Staff />} />
      </Routes>
    </BrowserRouter>
  );
}
