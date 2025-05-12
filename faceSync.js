const express = require("express");
const router = express.Router();
const db = require("./db");
const { writeFaceImageToPythonDisk } = require("./faceImageWriter");

router.get("/sync-images/:deviceUUID", async (req, res) => {
  const deviceUUID = req.params.deviceUUID?.toLowerCase().trim();

  if (!deviceUUID) {
    return res.status(400).json({ success: false, message: "Missing deviceUUID" });
  }

  try {
    const [rows] = await db.query(`
      SELECT ef.employeeId, ef.imageBase64, e.employeeNumber, ef.companyId
      FROM employee_faces ef
      JOIN Employees e ON ef.employeeId = e.id
      JOIN Devices d ON ef.companyId = d.companyId
      WHERE LOWER(d.deviceUUID) = :deviceUUID
    `, { replacements: { deviceUUID } });

    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: "No face images found." });
    }

    console.log("💾 DB returned rows:", rows.length);
    for (const record of rows) {
      if (!record || !record.imageBase64) {
        console.warn(`⚠️ Missing imageBase64 for employeeId=${record?.employeeId}`);
        continue;
      }

      console.log(`📸 Writing image for employeeId=${record.employeeId}`);
      writeFaceImageToPythonDisk(record.imageBase64, record.companyId, record.employeeNumber);
    }

    res.json({
      success: true,
      count: rows.length,
      message: `✅ Synced ${rows.length} face image(s) for company ${rows[0].companyId}`,
    });
  } catch (err) {
    console.error("❌ Failed to sync images:", err);
    res.status(500).json({ success: false, error: "Server error during face sync" });
  }
});

module.exports = router;

