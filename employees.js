const express   = require('express');
const multer    = require('multer');
const path      = require('path');
const fs        = require('fs');
const sequelize = require('./db');
const router    = express.Router();

// Folder to save uploaded images
const IMAGE_FOLDER = path.join(__dirname, 'images');
console.log('🔧 [employees.js] IMAGE_FOLDER set to', IMAGE_FOLDER);

// Ensure image directory exists
if (!fs.existsSync(IMAGE_FOLDER)) {
  fs.mkdirSync(IMAGE_FOLDER, { recursive: true });
  console.log('📁 Created image folder:', IMAGE_FOLDER);

}

// Multer storage setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    console.log('🗂️ [Multer] Writing file to', IMAGE_FOLDER);
    cb(null, IMAGE_FOLDER);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const employeeNo = req.params.id;
    const action = req.body.action || 'unknown';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `employee_${employeeNo}_${action}_${timestamp}${ext}`;
    console.log(`📝 [Multer] Generated filename for upload: ${filename}`);
    cb(null, filename);
  }
});
const upload = multer({ storage });

// POST /api/:id/photos — Upload image and attach to TimeRecord
router.post('/:id/photos', upload.single('photo'), async (req, res) => {
  try {
    const employeeNumber = parseInt(req.params.id, 10);
    const { action, deviceUUID } = req.body;
    const file = req.file;
    const today = new Date().toISOString().slice(0, 10);

    console.log('📥 Params:', req.params);
    console.log('📥 Body:', req.body);
    console.log('📥 File:', file);

    if (!employeeNumber || !action || !deviceUUID) {
      console.warn('⚠️ Missing required fields');
      return res.status(400).json({ success: false, error: 'employee id, action and deviceUUID are required' });
    }

    if (!file) {
      console.warn('⚠️ No photo uploaded');
      return res.status(400).json({ success: false, error: 'No photo file uploaded' });
    }

    // 1️⃣ Validate device
    console.log('🔍 Validating device...');
    const [[device]] = await sequelize.query(`
      SELECT id AS deviceId, companyId, outletId
        FROM Devices
       WHERE deviceUUID = :deviceUUID
    `, { replacements: { deviceUUID } });

    if (!device) {
      console.error('❌ Device not found');
      return res.status(404).json({ success: false, error: 'Device not found' });
    }
    console.log('✅ Device validated:', device);

    // 2️⃣ Validate employee
    console.log('🔍 Validating employee...');
    const [[emp]] = await sequelize.query(`
      SELECT id
        FROM Employees
       WHERE employeeNumber = :employeeNumber AND companyId = :companyId
    `, { replacements: { employeeNumber, companyId: device.companyId } });

    if (!emp) {
      console.error('❌ Employee not in this company');
      return res.status(403).json({ success: false, error: 'Employee not in this company' });
    }
    console.log('✅ Employee validated:', emp);

    // 3️⃣ Get open time record
    console.log('🔍 Looking for open time record...');
    const [records] = await sequelize.query(`
      SELECT id, clockInTime, clockOutTime, breakStartTime, breakEndTime, break2StartTime, break2EndTime, break3StartTime, break3EndTime
          FROM TimeRecords
        WHERE employeeId = :employeeId
          AND deviceId   = :deviceId
          AND outletId   = :outletId
          AND companyId  = :companyId
          AND [date]     = :today
          AND clockInTime IS NOT NULL
        ORDER BY updatedAt DESC
    `, {
      //, img1, img2, img3, img4, img5, img6, img7, img8
      replacements: {
        employeeId: emp.id,
        deviceId: device.deviceId,
        outletId: device.outletId,
        companyId: device.companyId,
        today
      }
    });

    if (!records.length) {
      console.warn('⚠️ No open TimeRecord found');
      return res.status(404).json({ success: false, error: 'No open TimeRecord found' });
    }

    const rec = records[0];
    console.log('🧾 Open TimeRecord found:', rec); // 👈 add this
    const fileUrl = `${req.protocol}://${req.get('host')}/images/${path.basename(file.path)}`;
    console.log(`🌐 Generated file URL: ${fileUrl}`);

    let imgCol = null;

    // 4️⃣ Determine image column
    if (action === 'clock_in' ){
      if (rec.clockInTime && !rec.img1) {   
        imgCol = 'img1';   
    }
  } else if (action === 'break_start') {
      if (rec.breakStartTime && !rec.breakEndTime && !rec.img3) {
        imgCol = 'img3';
      } else if (rec.break2StartTime && rec.img3 && !rec.img5) {
        imgCol = 'img5';
      } else if (rec.break3StartTime && rec.img3 && rec.img5 && !rec.img7) {
        imgCol = 'img7';
      }
    } else if (action === 'break_stop') {
      if (rec.breakEndTime && !rec.img4) {
        imgCol = 'img4';
      } else if (rec.break2EndTime && !rec.img6) {
        imgCol = 'img6';
      } else if (rec.break3EndTime && !rec.img8) {
        imgCol = 'img8';
      }
    } else {
      imgCol = 'img2';  
    }
    

    console.log(`🔧 Selected image column: ${imgCol}`);

    if (!imgCol) {
      console.warn('⚠️ No available image slot for action:', action);
      return res.status(400).json({ success: false, error: 'No available image slot for this action' });
    }

    // 5️⃣ Update record with image URL
    console.log(`📤 Updating TimeRecord ID=${rec.id} - setting ${imgCol} to fileUrl`);
    await sequelize.query(`
      UPDATE TimeRecords
         SET ${imgCol} = :url,
             updatedAt = CURRENT_TIMESTAMP
       WHERE id = :id
    `, { replacements: { url: fileUrl, id: rec.id } });

    console.log(`✅ Updated TimeRecord ${rec.id}, set ${imgCol}`);

    return res.status(200).json({
      success: true,
      message: `Photo saved to ${imgCol}`,
      urls: [fileUrl]
    });

  } catch (err) {
    console.error('❌ Server error in photo upload handler:', err);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: 'Internal server error', details: err.message });
    }
  }
});

// GET /api/employees — Return list of active employees
router.get('/employees', async (req, res) => {
  try {
    const [employees] = await sequelize.query(`
      SELECT employeeNumber, pinCode AS pin, companyId FROM Employees WHERE active = 1
    `);
    res.json({ success: true, count: employees.length, employees });
  } catch (err) {
    console.error('❌ Failed to fetch employees:', err);
    res.status(500).json({ success: false, error: 'Could not fetch employees', details: err.message });
  }
});

module.exports = router;
