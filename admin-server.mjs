#!/usr/bin/env node
/**
 * Local admin server for Midwest Airsoft Hub
 * Usage: node admin-server.mjs
 * Open:  http://localhost:3333/admin.html
 */

import { createServer } from "http";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const PORT = 3333;
const DATA = join(process.cwd(), "public/events-seed.json");

function load() {
  return JSON.parse(readFileSync(DATA, "utf8"));
}

function save(data) {
  data.lastUpdated = new Date().toISOString();
  data.events.sort((a, b) => {
    if (a.date === "recurring") return -1;
    if (b.date === "recurring") return 1;
    return a.date.localeCompare(b.date);
  });
  writeFileSync(DATA, JSON.stringify(data, null, 2));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(body ? JSON.parse(body) : {}));
  });
}

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

const server = createServer(async (req, res) => {
  if (req.url === "/" || req.url === "/admin.html") {
    const html = readFileSync(join(process.cwd(), "public/admin.html"), "utf8");
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(html);
  }

  if (req.url === "/api/admin") {
    if (req.method === "GET") return json(res, 200, load());

    const body = await readBody(req);

    if (req.method === "POST") {
      const { date, name, venue, state, type, price, url } = body;
      if (!date || !name || !venue || !state)
        return json(res, 400, { error: "Missing required fields" });

      const badge =
        type === "milsim" ? "MilSim" : type === "big" ? "Big Game" : "Open Play";

      const data = load();
      data.events.push({
        date,
        name,
        type: type || "open",
        price: price || null,
        url: url || null,
        venue,
        state: state.toUpperCase(),
        badge,
        base: true,
      });
      save(data);
      return json(res, 200, { ok: true, total: data.events.length });
    }

    if (req.method === "DELETE") {
      const idx = parseInt(body.index);
      const data = load();
      if (isNaN(idx) || idx < 0 || idx >= data.events.length)
        return json(res, 400, { error: "Invalid index" });
      const removed = data.events.splice(idx, 1)[0];
      save(data);
      return json(res, 200, { ok: true, removed: removed.name });
    }

    if (req.method === "PUT") {
      try {
        const today = new Date().toISOString().split("T")[0];
        execSync("git add public/events-seed.json", { cwd: process.cwd() });
        execSync(`git commit -m "Add events ${today}"`, { cwd: process.cwd() });
        execSync("git push", { cwd: process.cwd() });
        return json(res, 200, { ok: true, message: "Pushed — Vercel deploying now" });
      } catch (e) {
        return json(res, 500, { error: e.message });
      }
    }
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`\n  Admin tool running at http://localhost:${PORT}/admin.html\n`);
});
