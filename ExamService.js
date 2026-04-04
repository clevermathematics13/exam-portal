/**
 * ==============================================================================
 * 🧠 EXAM SERVICE (FINAL)
 * - Handles data retrieval, processing, and calculations for exams.
 * - Dependencies: Utils.gs, SyllabusService.gs
 * ==============================================================================
 */

function getExamList() {
  var ss = SpreadsheetApp.openById(DB_ID);
  var studentSheet = ss.getSheetByName("Students"); 
  if (studentSheet.getLastRow() < 2) return []; 
  var data = studentSheet.getRange("G2:H" + studentSheet.getLastRow()).getValues();
  var examList = [];
  data.forEach(function(row) {
    if (row[0]) examList.push({ sheetId: row[0].toString(), displayName: row[1] || row[0], isCustom: false });
  });
  return examList;
}

function getStudentData(examSheetId, studentEmail) {
  var activeUser = Session.getActiveUser().getEmail().toLowerCase().trim();
  
  try {
      logToDebugSheet("START", "getStudentData called for ExamID: " + examSheetId);

      var isTeacher = CONFIG.TEACHERS.some(function(t) { return t.toLowerCase().trim() === activeUser; });

      if (isTeacher) {
          if (!studentEmail || studentEmail === "") studentEmail = null; 
      } else {
          studentEmail = activeUser;
      }
      
      var ss = SpreadsheetApp.openById(DB_ID);
      
      // 🔗 Calls SyllabusService.gs
      var syllabusMap = getSyllabusMap(); 

      var studentsTab = ss.getSheetByName("Students");
      var studentData = studentsTab.getDataRange().getValues();

      var examRow = -1, responseTabName = "", dashboardTabName = "", formUrl = "", examName = "";
      
      for (var i = 0; i < studentData.length; i++) {
        if (String(studentData[i][6]) === examSheetId) {
          examRow = i;
          dashboardTabName = studentData[i][6]; 
          examName = studentData[i][7];         
          responseTabName = studentData[i][8];  
          formUrl = studentData[i][9];          
          break;
        }
      }

      if (examRow === -1) {
          logToDebugSheet("ERROR", "Exam Config not found: " + examSheetId);
          return { status: "error", message: "Exam Config not found." };
      }
      
      if (responseTabName) {
          var rSheet = ss.getSheetByName(responseTabName);
          if (rSheet) {
              var currCols = rSheet.getMaxColumns();
              if (currCols < PDF_LINK_COL) rSheet.insertColumnsAfter(currCols, PDF_LINK_COL - currCols);
          }
      }

      var examStructure = [];
      var dashboardTab = ss.getSheetByName(dashboardTabName);
      if (!dashboardTab) return { status: "error", message: "Dashboard missing." };

      var dData = dashboardTab.getDataRange().getValues();
      var dHeaders = dData[0]; 
      var maxPointsRow = dData[2]; 
      var syllabusRow = dData[3]; 

      for (var q = 2; q < dHeaders.length; q++) {
        if (dHeaders[q] && dHeaders[q] !== "") {
           examStructure.push({
             label: dHeaders[q],
             max: (maxPointsRow[q] && !isNaN(maxPointsRow[q])) ? maxPointsRow[q] : 10
           });
        }
      }

      // --- TEACHER VIEW ---
      if (isTeacher && !studentEmail) {
        logToDebugSheet("MODE", "Loading Class Dashboard");
        var studentList = [];
        for (var s = 1; s < studentData.length; s++) {
          if (studentData[s][0]) {
             studentList.push({ email: studentData[s][0], name: studentData[s][1] || studentData[s][0] });
          }
        }
        
        var rTab = ss.getSheetByName(responseTabName);
        var headers = [], gradesMap = {}, responseMap = {};
        if (rTab) {
          var rData = rTab.getDataRange().getValues();
          for (var j = 0; j < rData.length; j++) responseMap[String(rData[j][1]).toLowerCase().trim()] = rData[j];
        }

        if (dData.length > 5) {
             var headerRow = dData[0];
             
             // TEACHER HEADERS
             for (var h = 2; h < headerRow.length; h++) {
                 if (headerRow[h]) headers.push({ label: headerRow[h], max: maxPointsRow[h] || 10 });
             }

             for (var r = 5; r < dData.length; r++) {
               var rowEmail = String(dData[r][0]).toLowerCase().trim();
               if (rowEmail.includes("@")) {
                 var sRowData = responseMap[rowEmail]; 
                 var scores = [], totalDiff = 0, totalMax = 0, pdfLink = "";
                 
                 if (sRowData && sRowData.length >= PDF_LINK_COL) pdfLink = sRowData[PDF_LINK_COL - 1];

                 // Loop stops at headerRow.length (Fixes "undefined" columns)
                 for (var c = 2; c < headerRow.length; c++) {
                   var tVal = dData[r][c];
                   var rawS = (sRowData && sRowData[c]) ? sRowData[c] : "-";
                   var sVal = (rawS === "" || rawS === null) ? "-" : rawS;

                   var maxP = maxPointsRow[c] || 10;
                   var tIsNum = (tVal !== "-" && tVal !== "" && !isNaN(tVal));
                   var sIsNum = (sVal !== "-" && sVal !== "" && !isNaN(sVal));
                   if (tIsNum && sIsNum) { totalDiff += Math.abs(tVal - sVal); totalMax += maxP; }
                   else if (tIsNum || sIsNum) { totalDiff += maxP; totalMax += maxP; }
                   scores.push({ t: tVal, s: sVal }); 
                 }
                 var disag = (totalMax > 0) ? ((totalDiff / totalMax) * 100).toFixed(1) : "0.0";
                 gradesMap[rowEmail] = { scores: scores, pdfUrl: pdfLink, disagreement: disag };
               }
             }
        }
        return { status: "teacher_view", examName: examName, students: studentList, headers: headers, gradesMap: gradesMap, isTeacher: true };
      }

      // --- STUDENT VIEW ---
      var responseTab = ss.getSheetByName(responseTabName);
      if (!responseTab) return { status: "error", message: "Response sheet missing" };

      var studentResponseRow = -1;
      var pdfLink = "";
      var rData = responseTab.getDataRange().getValues();

      for (var j = 0; j < rData.length; j++) {
        if (String(rData[j][1]).toLowerCase().trim() === studentEmail.toLowerCase().trim()) {
          studentResponseRow = j;
          if (rData[j].length >= PDF_LINK_COL) pdfLink = rData[j][PDF_LINK_COL - 1];
          break;
        }
      }

      if (studentResponseRow === -1) {
        return { status: "gatekeeper_locked", examName: examName, examId: examSheetId, structure: examStructure, isTeacher: isTeacher };
      }

      var studentRowData = rData[studentResponseRow];
      // Slice(2) aligns with Column C (Index 2)
      var savedAnswers = studentRowData.slice(2);

      var hasGrades = false, teacherRowData = [];
      for (var k = 5; k < dData.length; k++) {
        if (String(dData[k][0]).toLowerCase().trim() === studentEmail.toLowerCase().trim()) {
          teacherRowData = dData[k];
          for (var check = 2; check < teacherRowData.length; check++) {
              if (teacherRowData[check] !== "" && teacherRowData[check] !== null && !isNaN(teacherRowData[check])) {
                  hasGrades = true;
                  break;
              }
          }
          break;
        }
      }

      if (!hasGrades) {
        return { status: "pending", examName: examName, formUrl: formUrl, isTeacher: isTeacher, structure: examStructure, savedAnswers: savedAnswers };
      }

      var results = [];
      var totalDiff = 0, totalMax = 0;

      for (var x = 2; x < dHeaders.length; x++) {
          var qLabel = dHeaders[x];
          if (qLabel) {
             // Student Score
             var rawS = (x < studentRowData.length) ? studentRowData[x] : "-";
             var sScore = (rawS === "" || rawS === null) ? "-" : rawS;

             // Teacher Score (Force "-" if empty)
             var rawT = teacherRowData[x];
             var tScore = (rawT === "" || rawT === null || rawT === undefined) ? "-" : rawT;
             
             var maxP = (maxPointsRow[x] && !isNaN(maxPointsRow[x])) ? Number(maxPointsRow[x]) : 10;
             var sylCode = (syllabusRow && syllabusRow[x]) ? syllabusRow[x] : "-";
             
             // 🔗 Syllabus Lookup
             var sylDesc = syllabusMap[String(sylCode).trim()] || ""; 

             var sIsNum = (sScore !== "-" && sScore !== "" && !isNaN(sScore));
             var tIsNum = (tScore !== "-" && tScore !== "" && !isNaN(tScore));

             if (sIsNum && tIsNum) {
                totalDiff += Math.abs(Number(sScore) - Number(tScore));
                totalMax += maxP;
             } else if (sIsNum || tIsNum) {
                totalDiff += maxP;
                totalMax += maxP;
             }
             
             results.push({ 
                 question: qLabel, 
                 studentScore: sScore, 
                 teacherScore: tScore, 
                 max: maxP, 
                 syllabus: sylCode,
                 syllabusDesc: sylDesc
             });
          }
      }
      
      var disagreementVal = (totalMax > 0) ? ((totalDiff / totalMax) * 100).toFixed(1) : "0.0";
      var isDone = (pdfLink && String(pdfLink).includes("http"));
      
      return {
        status: "found",
        examName: examName,
        examId: examSheetId, 
        results: results,
        uploadedPdf: isDone ? pdfLink : "", 
        uploadComplete: isDone,
        disagreement: disagreementVal, 
        editUrl: formUrl,
        isTeacher: isTeacher
      };

  } catch (e) {
      // 🔗 Calls Utils.gs
      logToDebugSheet("CRITICAL ERROR", e.toString());
      return { status: "error", message: "Server Error: " + e.toString() };
  }
}

function submitWebExam(payload) {
  var ss = SpreadsheetApp.openById(DB_ID);
  var sheetName = payload.examName + "_R"; 
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { success: false, error: "Response sheet missing: " + sheetName };

  var currentMaxCols = sheet.getMaxColumns();
  if (currentMaxCols < PDF_LINK_COL) {
    sheet.insertColumnsAfter(currentMaxCols, PDF_LINK_COL - currentMaxCols);
  }

  // Security: enforce server-side identity — only teachers may submit on behalf of others
  var activeUser = Session.getActiveUser().getEmail().toLowerCase().trim();
  var isTeacher = CONFIG.TEACHERS.some(function(t) { return t.toLowerCase().trim() === activeUser; });
  var userEmail;
  if (isTeacher && payload.email) {
    userEmail = payload.email;
  } else {
    userEmail = Session.getActiveUser().getEmail();
  }
  var timestamp = new Date();
  
  var cleanAnswers = [];
  if (payload.answers && Array.isArray(payload.answers)) {
    cleanAnswers = payload.answers.map(function(a) {
      return (a === null || a === undefined || a === "") ? "-" : a;
    });
  }

  var rowData = [timestamp, userEmail].concat(cleanAnswers);
  var data = sheet.getDataRange().getValues();
  var rowIndex = -1;
  
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][1]).toLowerCase().trim() === userEmail.toLowerCase().trim()) {
      rowIndex = i + 1;
      break;
    }
  }

  try {
    var rangeForCalc;
    if (rowIndex !== -1) {
      var range = sheet.getRange(rowIndex, 1, 1, rowData.length);
      range.setValues([rowData]);
      rangeForCalc = range;
    } else {
      sheet.appendRow(rowData);
      rangeForCalc = sheet.getRange(sheet.getLastRow(), 1, 1, rowData.length);
    }
    SpreadsheetApp.flush(); 
    try {
        var rowValues = rangeForCalc.getValues()[0]; 
        // 🔗 Calls Utils.gs
        calculateDisagreement({ range: rangeForCalc, values: rowValues, namedValues: { 'Email Address': [userEmail] } });
    } catch (calcError) { console.error("Calc warning: " + calcError); }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function getIdentityInfo() {
  var email = Session.getActiveUser().getEmail().toLowerCase().trim();
  var isTeacher = CONFIG.TEACHERS.some(function(t) { return t.toLowerCase().trim() === email; });
  
  // Try to find the name from the Students sheet
  var name = email; // Default to email
  try {
    var ss = SpreadsheetApp.openById(DB_ID);
    var sheet = ss.getSheetByName("Students");
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).toLowerCase().trim() === email) {
        name = data[i][1]; // Column B is Name
        break;
      }
    }
  } catch(e) { console.log(e); }

  return { email: email, name: name, isTeacher: isTeacher };
}