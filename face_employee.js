const db = require('./db');

exports.getTrainingFaces = async (deviceUUID) => {
  const [[device]] = await db.query(
    `SELECT companyId FROM Devices WHERE deviceUUID = :deviceUUID`,
    { replacements: { deviceUUID } }
  );
  if (!device) return { success: false, message: 'Device not found' };

  const companyId = device.companyId;

  const [rows] = await db.query(`
  SELECT ef.imageBase64, e.employeeNumber AS name
  FROM employee_faces ef
  JOIN Employees e ON ef.employeeId = e.id
  WHERE ef.companyId = :companyId

  `, { replacements: { companyId } });
  console.log("Training rows:", rows.map(r => ({
    employeeNumber: r.name,
    imageSize: r.imageBase64?.length
  })));
  
  if (!rows.length) return { success: false, message: 'No face data found for company' };

  console.log('🧪 Row sample:', rows[0]); // confirm again

  const trainingData = rows.map(row => {
    const name = row.name?.toString() || 'Unknown';  // 'name' was set to employeeNumber in SQL
  
    if (!name || name === 'Unknown') {
      console.warn('⚠️ Empty or missing name label for face:', row);
    }
  
    return {
      name,
      imageBase64: row.imageBase64
    };
  });
  
  return { success: true, trainingData };
  
};

exports.uploadFaceImage = async (req, res) => {
  const { employeeNumber, companyId, imageBase64 } = req.body;

  if (!employeeNumber || !companyId || !imageBase64) {
    return res.status(400).json({ success: false, message: 'Missing fields' });
  }

  try {
    // Get employee ID from number and company
    const [[employee]] = await db.query(`
      SELECT id FROM Employees WHERE employeeNumber = :employeeNumber AND companyId = :companyId
    `, {
      replacements: { employeeNumber, companyId }
    });

    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    await db.query(`
      INSERT INTO employee_faces (employeeId, companyId, imageBase64)
      VALUES (:employeeId, :companyId, :imageBase64)
    `, {
      replacements: {
        employeeId: employee.id,
        companyId,
        imageBase64
        
      }
      
    });

    return res.json({ success: true, message: 'Face image uploaded' });
  } catch (err) {
    console.error('❌ Face upload error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
