import express from "express";
import multer from "multer";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { commitBatch, previewUpload } from "../services/ingestService.js";
import { RawImport, User } from "../models/index.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const okMime = ["text/csv", "application/vnd.ms-excel", "application/octet-stream"].includes(
      file.mimetype
    );
    const okExt = /\.csv$/i.test(file.originalname || "");
    if (okMime || okExt) return cb(null, true);
    cb(new HttpError(400, `Only .csv files are accepted (got ${file.mimetype})`));
  },
});

const uploadOne = (fieldName) => (req, res, next) => {
  upload.single(fieldName)(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") return next(new HttpError(400, "File exceeds 20MB limit"));
      return next(new HttpError(400, `Upload error: ${err.message}`));
    }
    next(err);
  });
};

router.use(requireAuth, requireRole("operator", "admin"));

router.post(
  "/upload",
  uploadOne("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "Missing 'file' field");
    const fileType = req.body?.fileType;
    if (!fileType) throw new HttpError(400, "Missing 'fileType' field");

    const rawText = req.file.buffer.toString("utf8");
    const result = await previewUpload({
      fileType,
      originalFilename: req.file.originalname,
      rawText,
      uploadedBy: req.user.id,
      actorRole: req.user.role,
    });
    // _rawImportId is internal; strip before returning.
    delete result._rawImportId;
    res.status(201).json(result);
  })
);

router.post(
  "/commit/:batchId",
  asyncHandler(async (req, res) => {
    const result = await commitBatch(req.params.batchId, {
      actor: req.user.id,
      actorRole: req.user.role,
    });
    res.json(result);
  })
);

router.get(
  "/imports",
  asyncHandler(async (req, res) => {
    const query = req.user.role === "admin" ? {} : { uploadedBy: req.user.id };
    const imports = await RawImport.find(query)
      .select("-rawText")
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    const userIds = [...new Set(imports.map((i) => String(i.uploadedBy)).filter(Boolean))];
    const users = userIds.length
      ? await User.find({ _id: { $in: userIds } }).select("email name role").lean()
      : [];
    const userMap = new Map(users.map((u) => [String(u._id), u]));
    const items = imports.map((i) => ({
      ...i,
      uploadedByUser: userMap.get(String(i.uploadedBy)) || null,
    }));

    res.json({ items, total: items.length });
  })
);

router.get(
  "/imports/:batchId",
  asyncHandler(async (req, res) => {
    const doc = await RawImport.findOne({ batchId: req.params.batchId }).lean();
    if (!doc) throw new HttpError(404, "Batch not found");
    if (req.user.role !== "admin" && String(doc.uploadedBy) !== req.user.id) {
      throw new HttpError(403, "Not authorized to view this batch");
    }
    res.json(doc);
  })
);

export default router;
