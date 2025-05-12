// utils/faceImageWriter.js
const fs = require("fs");
const path = require("path");

/**
 * Writes an employee face image from base64 or Buffer to disk for Python.
 * @param {string|Buffer} imageData - base64 string (with or without header) or Buffer
 * @param {number|string} companyId - company ID
 * @param {number|string} employeeNumber - employee number
 */
function writeFaceImageToPythonDisk(imageData, companyId, employeeNumber) {
    const dirPath = path.join(__dirname, "face_recognition_service", "images", String(companyId));
    const timestamp = Date.now();
    const filename = `${employeeNumber}_${timestamp}.jpg`;
    const filePath = path.join(dirPath, filename);
  
    console.log(`📂 Attempting to write to: ${filePath}`);
    fs.mkdirSync(dirPath, { recursive: true });
  
    if (Buffer.isBuffer(imageData)) {
      fs.writeFileSync(filePath, imageData);
    } else {
      const cleanBase64 = imageData.replace(/^data:image\/\w+;base64,/, "");
      fs.writeFileSync(filePath, cleanBase64, "base64");
    }
  
    console.log(`✅ Saved face: ${filePath}`);
    return filePath;
  }
  

module.exports = { writeFaceImageToPythonDisk };
