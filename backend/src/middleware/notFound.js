export const notFound = (req, res) => {
  res.status(404).json({ ok: false, error: "Not Found", path: req.originalUrl });
};
