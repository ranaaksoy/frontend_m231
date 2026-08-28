import express from "express";
import cors from "cors";
import morgan from "morgan";
import { helloWorld } from "../handlers/helloWorld.js";

// Entspricht router::routes() aus router/mod.rs
export function createRouter() {
  const app = express();

  // Entspricht dem TraceLayer aus main.rs
  app.use(morgan("dev"));

  // Entspricht der CorsLayer (nur Origin http://localhost:3000, nur GET)
  const corsOptions = {
    origin: "http://localhost:8080",
    methods: ["GET"],
  };
  app.use(cors(corsOptions));

  app.get("/helloworld", helloWorld);

  return app;
}
