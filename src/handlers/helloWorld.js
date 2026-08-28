// Entspricht src/handlers/hello_world.rs
export function helloWorld(req, res) {
  res.type("text/plain").send("Hello World!");
}
