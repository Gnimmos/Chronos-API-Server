// employees.js
const express   = require('express');
const multer    = require('multer');
const path      = require('path');
const sequelize = require('./db');
const router    = express.Router();

const IMAGE_FOLDER = 'D:/Nodejs/Employees_CheckIn_API/Images';

// Multer storage config…
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, IMAGE_FOLDER),
  filename:    (req, file, cb) => {
    const ext        = path.extname(file.originalname);
    const employeeNo = req.params.id;
    const action     = req.body.action || 'unknown';
    const timestamp  = new Date().toISOString().replace(/[:.]/g, '-');
    cb(null, `employee_${employeeNo}_${action}_${timestamp}${ext}`);
  }
});
const upload = multer({ storage });

// ─── Photo‐upload endpoint ─────────────────────────────────────────────
router.post('/:id/photos', upload.array('photos', 10), async (req, res) => {
  try {
    const employeeNumber = parseInt(req.params.id, 10);
    const { action, deviceUUID } = req.body;
    if (!employeeNumber || !action || !deviceUUID) {
      return res
        .status(400)
        .json({ success:false, error:'employee id, action and deviceUUID are required' });
    }

    // 1️⃣ Validate device
    const [[ device ]] = await sequelize.query(`
      SELECT
        id      AS deviceId,
        companyId,
        outletId
      FROM Devices
      WHERE deviceUUID = :deviceUUID
    `, {
      replacements: { deviceUUID }
    });
    if (!device) {
      return res.status(404).json({ success:false, error:'Device not found' });
    }

    // 2️⃣ Validate employee
    const [[ emp ]] = await sequelize.query(`
      SELECT id
      FROM Employees
      WHERE employeeNumber = :employeeNumber
        AND companyId     = :companyId
    `, {
      replacements: {
        employeeNumber,
        companyId: device.companyId
      }
    });
    if (!emp) {
      return res.status(403).json({ success:false, error:'Employee not in this company' });
    }

    const today = new Date().toISOString().slice(0,10);
// ✅ NEW: grab the latest record for today (regardless of clockOutTime)
const [ rows ] = await sequelize.query(`
  SELECT
    id,
    breakStartTime, breakEndTime,
    break2StartTime, break2EndTime,
    break3StartTime, break3EndTime
  FROM TimeRecords
  WHERE employeeId = :employeeId
    AND deviceId   = :deviceId
    AND outletId   = :outletId
    AND companyId  = :companyId
    AND [date]     = :today
  ORDER BY id DESC
`, {
  replacements: {
    employeeId: emp.id,
    deviceId:   device.deviceId,
    outletId:   device.outletId,
    companyId:  device.companyId,
    today
  }
});

if (!rows.length) {
  return res
    .status(404)
    .json({ success:false, error:'No TimeRecords row found for today' });
}

const rec = rows[0];  // most‐recent record

    if (!rec) {
      return res
        .status(404)
        .json({ success:false, error:'No open TimeRecords row to attach photo to' });
    }

    // …(you’d enforce your punch‐order rules here)…

    // 4️⃣ Build URLs and pick the right img column
    const urls = req.files.map(f =>
      `${req.protocol}://${req.get('host')}/images/${path.basename(f.path)}`
    );
    let imgCol = null;
    if      (action==='clock_in')    imgCol='img1';
    else if (action==='clock_out')   imgCol='img2';
    else if (action==='break_start') {
      if (!rec.breakStartTime)        imgCol='img3';
      else if (!rec.break2StartTime)  imgCol='img5';
      else if (!rec.break3StartTime)  imgCol='img7';
    }
    else /* break_stop */ {
      if (!rec.breakEndTime)          imgCol='img4';
      else if (!rec.break2EndTime)    imgCol='img6';
      else if (!rec.break3EndTime)    imgCol='img8';
    }

    // 5️⃣ Only update if we found a slot
    if (imgCol) {
      const [ updateResult ] = await sequelize.query(`
        UPDATE TimeRecords
           SET ${imgCol}    = :url,
               updatedAt   = GETDATE()
         WHERE id          = :id
           AND deviceId    = :deviceId
           AND outletId    = :outletId
           AND companyId   = :companyId
      `, {
        replacements: {
          url:        urls[0],
          id:         rec.id,
          deviceId:   device.deviceId,
          outletId:   device.outletId,
          companyId:  device.companyId
        }
      });
      console.log('✅ Photo update result:', updateResult);
    }

    return res.json({
      success: true,
      message: imgCol
        ? `Photo saved to ${imgCol}`
        : 'No available img slot',
      urls
    });

  } catch (err) {
    console.error('❌ Photo + DB update error:', err);
    return res.status(500).json({ success:false, error:'Server error' });
  }
});

module.exports = router;
