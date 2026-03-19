import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- In-memory Data Store ---
let users = [
  { id: "admin", username: "admin", name: "栄養科 担当", role: "admin" },
  { id: "staff1", username: "staff1", name: "佐藤 健一", role: "student" }
];

let menu = [];
let reservations = [];

// Initialize menu with some data
const today = new Date();
for (let i = 0; i < 14; i++) {
  const d = new Date(today);
  d.setDate(today.getDate() + i);
  if (d.getDay() === 0 || d.getDay() === 6) continue;
  
  const dateStr = d.toISOString().split('T')[0];
  menu.push({
    id: `${dateStr}_lunch`,
    date: dateStr,
    meal_type: "lunch",
    title: i % 5 === 0 ? "サバの味噌煮" : i % 5 === 1 ? "鶏の唐揚げ" : i % 5 === 2 ? "ハンバーグ" : i % 5 === 3 ? "カレーライス" : "肉じゃが",
    description: "小鉢、味噌汁、ご飯付き",
    calories: 600 + (i * 10) % 100,
    allergens: "小麦, 大豆"
  });
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '20mb' }));

  // API Routes
  app.get("/api/health", (req, res) => res.json({ status: "ok" }));

  app.post("/api/login", (req, res) => {
    const { username } = req.body;
    const user = users.find(u => u.username === username);
    if (user) {
      res.json(user);
    } else {
      res.status(401).json({ error: "職員IDが見つかりません" });
    }
  });

  app.get("/api/user", (req, res) => {
    const userId = req.headers["x-user-id"] as string;
    const user = users.find(u => u.id === userId);
    if (user) res.json(user);
    else res.status(404).json({ error: "User not found" });
  });

  app.get("/api/menu", (req, res) => {
    res.json(menu);
  });

  app.get("/api/reservations", (req, res) => {
    const userId = req.headers["x-user-id"] as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    
    const userRes = reservations.filter(r => r.user_id === userId);
    const enriched = userRes.map(r => {
      const m = menu.find(item => item.id === r.menu_id);
      return { ...r, date: m?.date, title: m?.title, meal_type: m?.meal_type };
    });
    res.json(enriched);
  });

  app.post("/api/reservations", (req, res) => {
    const { menuId } = req.body;
    const userId = req.headers["x-user-id"] as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const existing = reservations.find(r => r.user_id === userId && r.menu_id === menuId);
    if (existing) return res.status(400).json({ error: "Already reserved" });

    const newRes = {
      id: `${userId}_${menuId}`,
      user_id: userId,
      menu_id: menuId,
      status: 'reserved',
      consumed: false,
      created_at: new Date().toISOString()
    };
    reservations.push(newRes);
    res.json({ success: true });
  });

  app.post("/api/reservations/guest", (req, res) => {
    const { menuId, guestName } = req.body;
    if (!guestName) return res.status(400).json({ error: "お名前を入力してください" });
    
    const newRes = {
      id: `guest_${Date.now()}`,
      menu_id: menuId,
      guest_name: guestName,
      status: 'reserved',
      consumed: false,
      created_at: new Date().toISOString()
    };
    reservations.push(newRes);
    res.json({ success: true });
  });

  app.delete("/api/reservations/:menuId", (req, res) => {
    const { menuId } = req.params;
    const userId = req.headers["x-user-id"] as string;
    reservations = reservations.filter(r => !(r.user_id === userId && r.menu_id === menuId));
    res.json({ success: true });
  });

  // Admin Routes
  app.get("/api/admin/users", (req, res) => res.json(users));
  
  app.post("/api/admin/users", (req, res) => {
    const { username, name, role } = req.body;
    const newUser = { id: username, username, name, role: role || 'student' };
    users.push(newUser);
    res.json({ success: true });
  });

  app.post("/api/admin/users/bulk", (req, res) => {
    const { users: newUsers } = req.body;
    if (!Array.isArray(newUsers)) return res.status(400).json({ error: "Invalid data" });
    newUsers.forEach(u => {
      if (!users.find(existing => existing.username === u.username)) {
        users.push({ id: u.username, ...u, role: u.role || 'student' });
      }
    });
    res.json({ success: true, count: newUsers.length });
  });

  app.delete("/api/admin/users/bulk-delete", (req, res) => {
    // For simplicity, this might be used to clear non-admin users or similar
    // Based on App.tsx, it's called to delete multiple users
    const { userIds } = req.body; // Assuming it sends userIds
    if (Array.isArray(userIds)) {
      users = users.filter(u => !userIds.includes(u.id) || u.id === 'admin');
      reservations = reservations.filter(r => !userIds.includes(r.user_id));
    } else {
      // If no IDs provided, maybe it's a "delete all non-admins"
      users = users.filter(u => u.role === 'admin');
      reservations = reservations.filter(r => users.find(u => u.id === r.user_id));
    }
    res.json({ success: true });
  });

  app.put("/api/admin/users/:id", (req, res) => {
    const { id } = req.params;
    const { name, role } = req.body;
    const user = users.find(u => u.id === id);
    if (user) {
      user.name = name;
      user.role = role;
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "User not found" });
    }
  });

  app.delete("/api/admin/users/:id", (req, res) => {
    const { id } = req.params;
    if (id === 'admin') return res.status(400).json({ error: "Admin cannot be deleted" });
    users = users.filter(u => u.id !== id);
    reservations = reservations.filter(r => r.user_id !== id);
    res.json({ success: true });
  });

  app.get("/api/admin/stats", (req, res) => {
    const stats = menu.map(m => {
      const menuRes = reservations.filter(r => r.menu_id === m.id);
      const names = menuRes.map(r => r.user_id ? (users.find(u => u.id === r.user_id)?.name || r.user_id) : `ゲスト: ${r.guest_name}`).join(", ");
      return { ...m, count: menuRes.length, names };
    });
    res.json(stats);
  });

  app.get("/api/admin/monthly-report", (req, res) => {
    const { month } = req.query; // Format: YYYY-MM
    const students = users.filter(u => u.role === 'student');
    const monthMenus = menu.filter(m => m.date.startsWith(month as string));
    const monthMenuIds = monthMenus.map(m => m.id);

    const report = students.map(u => {
      const userRes = reservations.filter(r => r.user_id === u.id && monthMenuIds.includes(r.menu_id));
      
      let lunch_count = 0, lunch_consumed = 0, dinner_count = 0, dinner_consumed = 0;
      
      userRes.forEach(r => {
        const m = monthMenus.find(item => item.id === r.menu_id);
        if (m) {
          if (m.meal_type === 'lunch') {
            lunch_count++;
            if (r.consumed) lunch_consumed++;
          } else if (m.meal_type === 'dinner') {
            dinner_count++;
            if (r.consumed) dinner_consumed++;
          }
        }
      });

      return {
        name: u.name,
        username: u.username,
        lunch_count,
        lunch_consumed,
        dinner_count,
        dinner_consumed,
        total_count: lunch_count + dinner_count,
        total_consumed: lunch_consumed + dinner_consumed
      };
    });

    res.json(report);
  });

  app.get("/api/admin/daily-checklist", (req, res) => {
    const { date } = req.query;
    const dayMenus = menu.filter(m => m.date === date);
    const dayMenuIds = dayMenus.map(m => m.id);
    
    const checklist = reservations
      .filter(r => dayMenuIds.includes(r.menu_id))
      .map(r => {
        const user = users.find(u => u.id === r.user_id);
        const m = menu.find(item => item.id === r.menu_id);
        return {
          id: r.id,
          name: user ? user.name : `ゲスト: ${r.guest_name}`,
          username: user ? user.username : 'GUEST',
          consumed: r.consumed,
          meal_type: m?.meal_type || 'lunch'
        };
      });
    res.json(checklist);
  });

  app.post("/api/admin/reservations/:id/toggle-consumed", (req, res) => {
    const { id } = req.params;
    const { consumed } = req.body;
    const reservation = reservations.find(r => r.id === id);
    if (reservation) {
      reservation.consumed = !!consumed;
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Reservation not found" });
    }
  });

  app.post("/api/admin/menu", (req, res) => {
    const item = req.body;
    const id = `${item.date}_${item.meal_type || 'lunch'}`;
    const existingIndex = menu.findIndex(m => m.id === id);
    if (existingIndex >= 0) {
      menu[existingIndex] = { id, ...item };
    } else {
      menu.push({ id, ...item });
    }
    res.json({ success: true });
  });

  app.post("/api/admin/menu/bulk", (req, res) => {
    const { menus: newMenus } = req.body;
    if (!Array.isArray(newMenus)) return res.status(400).json({ error: "Invalid data" });
    
    newMenus.forEach(item => {
      const id = `${item.date}_${item.meal_type || 'lunch'}`;
      const existingIndex = menu.findIndex(m => m.id === id);
      if (existingIndex >= 0) {
        menu[existingIndex] = { id, ...item };
      } else {
        menu.push({ id, ...item });
      }
    });
    res.json({ success: true, count: newMenus.length });
  });

  app.delete("/api/admin/menu/:id", (req, res) => {
    const { id } = req.params;
    menu = menu.filter(m => m.id !== id);
    reservations = reservations.filter(r => r.menu_id !== id);
    res.json({ success: true });
  });

  app.post("/api/admin/proxy-fetch", async (req, res) => {
    let { url } = req.body;
    try {
      if (url.includes('drive.google.com')) {
        const fileIdMatch = url.match(/\/d\/([^\/]+)/) || url.match(/id=([^\&]+)/);
        if (fileIdMatch && fileIdMatch[1]) {
          url = `https://drive.google.com/uc?export=download&id=${fileIdMatch[1]}`;
        }
      }
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);
      let mimeType = response.headers.get('content-type') || 'image/jpeg';
      if (mimeType.includes('text/html') || mimeType.includes('text/plain')) {
        const text = await response.text();
        const cleanText = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return res.json({ text: cleanText, mimeType: 'text/plain' });
      }
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      res.json({ base64, mimeType });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/users/switch/:username", (req, res) => {
    const { username } = req.params;
    const user = users.find(u => u.username === username);
    if (user) {
      res.json(user);
    } else {
      res.status(404).json({ error: "User not found" });
    }
  });

  app.get("/api/debug/force-seed", (req, res) => {
    // In-memory already has seed data, but we can reset it if needed
    // For now, just return success
    res.json({ success: true, message: "In-memory data is active" });
  });

  // Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
