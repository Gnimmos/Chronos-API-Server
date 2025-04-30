require('dotenv').config();
const express = require('express');
const sequelize = require('./db');
const bcrypt = require('bcryptjs');
const app = express();
const employeesRouter = require('./employees');


app.use(express.json());
const cors = require('cors');
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use('/employees', employeesRouter);

/**
 * SUPERUSER LOGIN - Authenticate via password, return company info
 */

app.post('/api/superuser/login', async (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: 'Password is required' });
  }

  try {
    // Fetch user by role or specific identifier
    const [users] = await sequelize.query(`
      SELECT id, username, password
      FROM Users
      WHERE role = 'super_admin'
    `);

    if (users.length === 0) {
      return res.status(404).json({ error: 'No Super User found' });
    }

    const user = users[0];

    // Compare hashed password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    res.json({ success: true, message: 'Authenticated', userId: user.id });

  } catch (err) {
    console.error('❌ Superuser login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});
/**
 * Validate users - Authenticate via pin
 */
app.post('/api/employee/validate', async (req, res) => {
  let { employeeNumber, pinCode, deviceUUID } = req.body;

  if (!employeeNumber || !pinCode || !deviceUUID) {
    return res.status(400).json({ success: false, error: 'employeeNumber, pinCode, and deviceUUID are required' });
  }

  // coerce to the right types
  employeeNumber = parseInt(employeeNumber, 10);
  const pin = parseInt(pinCode, 10);

  try {
    // 1️⃣ grab device
    const [devices] = await sequelize.query(`
      SELECT id AS deviceId, companyId
      FROM Devices
      WHERE deviceUUID = :deviceUUID
    `, { replacements: { deviceUUID } });

    if (devices.length === 0) {
      return res.status(404).json({ success: false, error: 'Device not found' });
    }
    const { deviceId, companyId } = devices[0];

    // 2️⃣ grab employee by their three-digit number
    const [emps] = await sequelize.query(`
      SELECT id, firstName, lastName, pinCode
      FROM Employees
      WHERE employeeNumber = :employeeNumber
        AND companyId = :companyId
    `, { replacements: { employeeNumber, companyId } });

    if (emps.length === 0) {
      return res.status(403).json({ success: false, error: 'Employee not found in this company' });
    }

    const emp = emps[0];

    // **compare as numbers**
    if (emp.pinCode !== pin) {
      return res.status(401).json({ success: false, error: 'Invalid PIN' });
    }

    res.json({
      success: true,
      employee: { id: emp.id, name: `${emp.firstName} ${emp.lastName}` }
    });

  } catch (err) {
    console.error('❌ Employee validation error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});



/**
 * Clock in
 */
// index.js
// index.js
app.post('/api/attendance/record', async (req, res) => {
  let { employeeNumber, action, deviceUUID } = req.body;
  if (!employeeNumber || !action || !deviceUUID) {
    return res.status(400).json({ success:false, error:'employeeNumber, action, and deviceUUID are required' });
  }
  employeeNumber = parseInt(employeeNumber, 10);

  try {
    // ─── 1️⃣ Device lookup ──────────────────────────────────────────────
    const [devices] = await sequelize.query(`
      SELECT id AS deviceId, companyId, outletId
        FROM Devices
       WHERE deviceUUID = :deviceUUID
    `, { replacements:{ deviceUUID } });
    if (devices.length === 0) {
      return res.status(404).json({ success:false, error:'Device not found' });
    }
    const { deviceId, companyId, outletId } = devices[0];

    // ─── 2️⃣ Employee lookup ────────────────────────────────────────────
    const [emps] = await sequelize.query(`
      SELECT id
        FROM Employees
       WHERE employeeNumber = :employeeNumber
         AND companyId     = :companyId
    `, { replacements:{ employeeNumber, companyId } });
    if (emps.length === 0) {
      return res.status(403).json({ success:false, error:'Employee not found in this company' });
    }
    const employeeId = emps[0].id;

    const today = new Date().toISOString().slice(0,10);

    // ─── clock_in ──────────────────────────────────────────────────────
    if (action === 'clock_in') {
      // block if an open shift already exists:
      const [open] = await sequelize.query(`
        SELECT id
          FROM TimeRecords
         WHERE employeeId   = :employeeId
           AND deviceId     = :deviceId
           AND outletId     = :outletId
           AND companyId    = :companyId
           AND [date]       = :today
           AND clockOutTime IS NULL
      `, { replacements:{ employeeId, deviceId, outletId, companyId, today }});
      if (open.length) {
        return res.status(400).json({ success:false, error:'Must clock out before clocking back in' });
      }

      await sequelize.query(`
        INSERT INTO TimeRecords
          (employeeId, deviceId, outletId, companyId, clockType, [date],
           clockInTime, clockInNote, createdAt, updatedAt, updatedBy)
        VALUES
          (:employeeId, :deviceId, :outletId, :companyId, 'pin', :today,
           GETDATE(), 'Started shift', GETDATE(), GETDATE(), 0)
      `, { replacements:{ employeeId, deviceId, outletId, companyId, today }});

      return res.json({ success:true, message:'Clock-in recorded' });
    }

    // ─── clock_out ─────────────────────────────────────────────────────
    else if (action === 'clock_out') {
      // must have an open shift, and not be mid-break
      const [rec] = await sequelize.query(`
        SELECT breakStartTime, breakEndTime
          FROM TimeRecords
         WHERE employeeId   = :employeeId
           AND deviceId     = :deviceId
           AND outletId     = :outletId
           AND companyId    = :companyId
           AND [date]       = :today
           AND clockOutTime IS NULL
      `, { replacements:{ employeeId, deviceId, outletId, companyId, today }});
      if (!rec.length) {
        return res.status(400).json({ success:false, error:'No open shift to clock out from' });
      }
      if (rec[0].breakStartTime && !rec[0].breakEndTime) {
        return res.status(400).json({ success:false, error:'Must end break before clocking out' });
      }

      await sequelize.query(`
        UPDATE TimeRecords
           SET clockOutTime = GETDATE(),
               clockOutNote = 'End of shift',
               updatedAt    = GETDATE()
         WHERE employeeId   = :employeeId
           AND deviceId     = :deviceId
           AND outletId     = :outletId
           AND companyId    = :companyId
           AND [date]       = :today
           AND clockOutTime IS NULL
      `, { replacements:{ employeeId, deviceId, outletId, companyId, today }});

      return res.json({ success:true, message:'Clock-out recorded' });
    }

    // ─── break_start / break_stop ──────────────────────────────────────
    else if (action === 'break_start' || action === 'break_stop') {
      // fetch only today's open record
      const [rows] = await sequelize.query(`
        SELECT id,
               breakStartTime, breakEndTime,
               break2StartTime, break2EndTime,
               break3StartTime, break3EndTime
          FROM TimeRecords
         WHERE employeeId   = :employeeId
           AND deviceId     = :deviceId
           AND outletId     = :outletId
           AND companyId    = :companyId
           AND [date]       = :today
           AND clockOutTime IS NULL
      `, { replacements:{ employeeId, deviceId, outletId, companyId, today }});
      if (!rows.length) {
        return res.status(404).json({ success:false, error:'No shift record for today' });
      }
      const rec = rows[0];

      // figure out which break slot to use
      let fieldStart = '', fieldEnd = '', noteStart = '', noteEnd = '';
      if      (!rec.breakStartTime)           { fieldStart = 'breakStartTime';  noteStart = 'Lunch';         }
      else if (!rec.breakEndTime && action==='break_stop')
                                              { fieldEnd   = 'breakEndTime';    noteEnd   = 'Back from lunch';}
      else if (!rec.break2StartTime)          { fieldStart = 'break2StartTime'; noteStart = 'Coffee break';   }
      else if (!rec.break2EndTime && action==='break_stop')
                                              { fieldEnd   = 'break2EndTime';   noteEnd   = 'Back to work';    }
      else if (!rec.break3StartTime)          { fieldStart = 'break3StartTime'; noteStart = 'Short break';    }
      else if (!rec.break3EndTime && action==='break_stop')
                                              { fieldEnd   = 'break3EndTime';   noteEnd   = 'Wrap-up';         }
      else {
        return res.status(400).json({ success:false, error:'No available break slots' });
      }

      // build SET clauses
      const sets = [];
      const repl = { id: rec.id };
      if (fieldStart) {
        sets.push(`${fieldStart} = GETDATE()`);
        if (fieldStart==='breakStartTime')  sets.push(`breakStartNote  = '${noteStart}'`);
        if (fieldStart==='break2StartTime') sets.push(`break2StartNote = '${noteStart}'`);
        if (fieldStart==='break3StartTime') sets.push(`break3StartNote = '${noteStart}'`);
      }
      if (fieldEnd) {
        sets.push(`${fieldEnd} = GETDATE()`);
        if (fieldEnd==='breakEndTime')  sets.push(`breakEndNote   = '${noteEnd}'`);
        if (fieldEnd==='break2EndTime') sets.push(`break2EndNote  = '${noteEnd}'`);
        if (fieldEnd==='break3EndTime') sets.push(`break3EndNote  = '${noteEnd}'`);
      }
      sets.push(`updatedAt = GETDATE()`);

      // update that same open record
      await sequelize.query(`
        UPDATE TimeRecords
           SET ${sets.join(', ')}
         WHERE id          = :id
           AND deviceId    = :deviceId
           AND outletId    = :outletId
           AND companyId   = :companyId
      `, { replacements:{ id:rec.id, deviceId, outletId, companyId }});

      return res.json({ success:true, message:`${action.replace('_',' ')} recorded` });
    }

    else {
      return res.status(400).json({ success:false, error:'Unknown action' });
    }
  }
  catch (err) {
    console.error('❌ Attendance error:', err);
    return res.status(500).json({ success:false, error:'Server error' });
  }
});




/**
 * REGISTER DEVICE (with debug logging)
 */
app.post('/api/device/register', async (req, res) => {
  // 🔍 1) Log exactly what the front end sent:
  console.log('📥 [/api/device/register] req.body =', req.body);

  const { companyId, outletId, deviceUUID, deviceName } = req.body;
  if (!companyId || !deviceUUID || !deviceName) {
    console.log('⚠️ missing fields:', { companyId, deviceUUID, deviceName });
    return res
      .status(400)
      .json({ success: false, error: 'companyId, deviceUUID and deviceName are required' });
  }

  try {
    // 🔍 2) Company lookup
    const [companyRows] = await sequelize.query(
      `SELECT * FROM Companies WHERE id = :companyId`,
      { replacements: { companyId } }
    );
    console.log('🔎 Companies result:', companyRows);
    if (!companyRows.length) {
      return res.status(404).json({ success: false, error: 'Company not found' });
    }

    // 🔍 3) Check existing deviceUUID
    const [existing] = await sequelize.query(
      `SELECT id FROM Devices WHERE deviceUUID = :deviceUUID`,
      { replacements: { deviceUUID } }
    );
    console.log('🔎 Existing devices with this UUID:', existing);
    if (existing.length) {
      return res.status(409).json({
        success: false,
        error: 'Device already registered',
        deviceId: existing[0].id
      });
    }

    // 🔍 4) Outlet validation (if needed)
    let outletToUse = null;
    const [companyOutlets] = await sequelize.query(
      `SELECT id FROM Outlets WHERE companyId = :companyId`,
      { replacements: { companyId } }
    );
    console.log('🔎 Outlets for company:', companyOutlets);
    if (companyOutlets.length) {
      if (!outletId) {
        console.log('⚠️ Company has outlets but no outletId provided');
        return res.status(400).json({
          success: false,
          error: 'This company has outlets. Please provide a valid outletId.'
        });
      }
      const [validOutlet] = await sequelize.query(
        `SELECT * FROM Outlets WHERE id = :outletId AND companyId = :companyId`,
        { replacements: { outletId, companyId } }
      );
      console.log('🔎 Validated outlet:', validOutlet);
      if (!validOutlet.length) {
        return res.status(404).json({
          success: false,
          error: 'Outlet not found or does not belong to company'
        });
      }
      outletToUse = outletId;
    }

    // 🔍 5) Perform the insert
    const defaultPassword = 'default123';
    const [insertResult] = await sequelize.query(
      `
      INSERT INTO Devices
        (companyId, outletId, deviceUUID, name, password, lastSync, active, createdAt, updatedAt)
      OUTPUT INSERTED.id
      VALUES
        (:companyId, :outletId, :deviceUUID, :deviceName, :password, GETDATE(), 1, GETDATE(), GETDATE())
      `,
      {
        replacements: {
          companyId,
          outletId:   outletToUse,
          deviceUUID,
          deviceName,
          password:   defaultPassword
        }
      }
    );
    console.log('✅ Insert result:', insertResult);

    // 🔍 6) Return both GUID and new PK
    const deviceId = insertResult[0].id;
    return res.json({
      success:    true,
      deviceUUID,    // as sent
      deviceId,      // newly minted
      company:    companyRows[0],
      outlet:     outletToUse ? { id: outletToUse } : null
    });

  } catch (err) {
    console.error('❌ Device registration error:', err);
    return res
      .status(500)
      .json({ success: false, error: 'Server error' });
  }
});

/**
 * EMPLOYEE PIN CHECK
 */
app.post('/api/employees/check', async (req, res) => {
    const { pinCode } = req.body;

    if (!pinCode) return res.status(400).json({ error: 'PIN is required' });

    try {
        const [results] = await sequelize.query(`
          SELECT id, firstName, lastName, type, sectionId, companyId
          FROM Employees
          WHERE  pinCode = :pinCode
        `, { replacements: { pinCode } });

        if (results.length === 0) return res.status(401).json({ error: 'Invalid PIN' });

        const employee = results[0];
        employee.photos = getEmployeePhotos(employee.id);

        res.json({ success: true, user: employee });
    } catch (err) {
        console.error('❌ Employee PIN check error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});


/**
 * GET COMPANY INFO
 */
app.get('/api/company/:id', async (req, res) => {
  const companyId = req.params.id;

  try {
    const [results] = await sequelize.query(`
      SELECT * FROM Companies WHERE id = :companyId
    `, { replacements: { companyId } });

    if (results.length === 0) return res.status(404).json({ error: 'Company not found' });

    res.json({ success: true, company: results[0] });
  } catch (err) {
    console.error('❌ Company info error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * REGISTER A COMPANY
 */
app.post('/api/device/register', async (req, res) => {
  const { companyId, outletId, deviceName } = req.body;
  console.log('📥 [/api/device/register] req.body =', req.body);
  if (!companyId || !deviceName) {
    return res.status(400).json({ error: 'companyId and deviceName are required' });
  }
  

  try {
    // 1️⃣ Validate Company
    const [companyResult] = await sequelize.query(`
      SELECT * FROM Companies WHERE id = :companyId
    `, { replacements: { companyId } });

    if (companyResult.length === 0) {
      return res.status(404).json({ success: false, error: 'Company not found' });
    }
    const [[{ name: currentDb }]] = await sequelize.query(`SELECT DB_NAME() AS name`);
    console.log('🗄️ Connected DB:', currentDb);

    // 2️⃣ Check if Company has Outlets
    const [outlets] = await sequelize.query(`
      SELECT id, name FROM Outlets WHERE companyId = :companyId
    `, { replacements: { companyId } });

    let outletResult = [];
    let outletIdToInsert = null;
    const [allDevices] = await sequelize.query(`
      SELECT id, deviceUUID
      FROM Devices
    `);
    console.log('📂 All devices in this DB:', allDevices);
    if (outlets.length > 0) {
      // Company HAS outlets ➜ Validate outletId from frontend
      if (!outletId || outletId <= 0) {
        return res.status(400).json({ success: false, error: 'This company has outlets. Please provide a valid outletId.' });
      }

      [outletResult] = await sequelize.query(`
        SELECT * FROM Outlets WHERE id = :outletId AND companyId = :companyId
      `, { replacements: { outletId, companyId } });

      if (outletResult.length === 0) {
        return res.status(404).json({ success: false, error: 'Outlet not found or does not belong to company' });
      }

      outletIdToInsert = outletId;

    } else {
      // Company has NO outlets ➜ Skip validation
      outletIdToInsert = null;
    }

    // 3️⃣ Insert Device
    const defaultPassword = 'default123';
    const deviceName = 'Registered Device';

    const [insertResult] = await sequelize.query(`
      INSERT INTO Devices (companyId, outletId, name, password, lastSync, active, createdAt, updatedAt)
      OUTPUT INSERTED.id
      VALUES (:companyId, :outletId, :name, :password, GETDATE(), 1, GETDATE(), GETDATE())
    `, {
      replacements: { 
        companyId, 
        outletId: outletIdToInsert,
        name: deviceName,
        password: defaultPassword 
      }
    });
    

    const deviceUUID  = insertResult[0].id;

    res.json({
      success: true,
      deviceUUID ,
      company: companyResult[0],
      outlet: outletResult[0] || null
    });

  } catch (err) {
    console.error('❌ Device registration error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});



app.get('/api/debug/companies/schema', async (req, res) => {
  try {
    const [results] = await sequelize.query(`SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    IS_NULLABLE,
    CHARACTER_MAXIMUM_LENGTH
FROM 
    INFORMATION_SCHEMA.COLUMNS
WHERE 
    TABLE_NAME = 'Companies';

`);
    res.json({ success: true, schema: results });
  } catch (err) {
    console.error('❌ Schema fetch error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});


app.get('/api/debug/schema', async (req, res) => {
  try {
    const [results] = await sequelize.query(`
      SELECT 
          TABLE_NAME,
          COLUMN_NAME,
          DATA_TYPE,
          IS_NULLABLE,
          CHARACTER_MAXIMUM_LENGTH
      FROM 
          INFORMATION_SCHEMA.COLUMNS
      ORDER BY 
          TABLE_NAME, COLUMN_NAME
    `);

    res.json({ success: true, schema: results });
  } catch (err) {
    console.error('❌ Schema fetch error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});


const fs = require('fs');
const path = require('path');
const multer = require('multer');

// Define storage path
const IMAGE_FOLDER = 'D:/Nodejs/Employees_CheckIn_API/Images';

// Ensure folder exists
if (!fs.existsSync(IMAGE_FOLDER)) {
    fs.mkdirSync(IMAGE_FOLDER, { recursive: true });
}
app.use('/images', express.static(IMAGE_FOLDER));

// Mount our employees router
app.use('/api/employees', employeesRouter);
// Configure Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
      cb(null, IMAGE_FOLDER);
  },
  filename: (req, file, cb) => {
      cb(null, file.originalname);  // Temp name, will rename later
  }
});

const upload = multer({ storage });

/**
 * UPLOAD EMPLOYEE PHOTO
 */
app.post('/api/employees/:id/photos', upload.array('photos', 10), (req, res) => {
  const employeeId = req.params.id;

  req.files.forEach((file, index) => {
      const ext = path.extname(file.originalname);
      const targetPath = path.join(IMAGE_FOLDER, `employee_${employeeId}_${index + 1}${ext}`);
      fs.renameSync(file.path, targetPath);
  });

  res.json({ success: true, message: 'Photos uploaded successfully!' });
});


/**
 * GET EMPLOYEE PHOTOS
 */
app.get('/api/employees/:id/photos', (req, res) => {
  const employeeId = req.params.id;
  const files = fs.readdirSync(IMAGE_FOLDER);

  const photoFiles = files.filter(file => file.startsWith(`employee_${employeeId}_`));

  if (photoFiles.length === 0) {
      return res.status(404).json({ error: 'No photos found for this employee' });
  }

  const photoUrls = photoFiles.map(file => 
      `http://localhost:${PORT}/api/employees/${employeeId}/photo/${file}`
  );

  res.json({ success: true, photos: photoUrls });
});

/**
 * GET EMPLOYEE ONE PHOTO
 */
app.get('/api/employees/:id/photo/:filename', (req, res) => {
  const { filename } = req.params;
  const imagePath = path.join(IMAGE_FOLDER, filename);

  if (fs.existsSync(imagePath)) {
      res.sendFile(imagePath);
  } else {
      res.status(404).json({ error: 'Photo not found' });
  }
});


/**
 * Start server
 */
const PORT = 3012;
app.listen(PORT, () => {
  console.log(`🚀 API server running at http://localhost:${PORT}`);
});
