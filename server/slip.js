// Parse a UniMAP "Course Registration Slip" PDF.
const pdfParse = require('pdf-parse');

function parseSlipText(text) {
  const field = (label) => {
    const m = text.match(new RegExp(label + '\\s*\\n?\\s*:\\s*(.+)', 'i'));
    return m ? m[1].trim() : null;
  };
  const courses = [];
  for (const line of text.split('\n')) {
    // " 1 IMJ41002 Projek Tahun Akhir 1[Final Year Project 1] 2 FT UR6523002"
    const m = line.match(/^\s*\d+\s+([A-Z]{3}\d{5})\s*(.*?)\s*(?:\[(.*?)\])?\s+(\d+)\s+([A-Z]{1,3})\s+(\S+)\s*$/);
    if (m) courses.push({ code: m[1], name: (m[3] || m[2]).trim(), name_local: m[2].trim(), credit: +m[4], status: m[5], grp: m[6] });
  }
  const session = text.match(/SEMESTER\s*(\d+)\s+ACADEMIC SESSION\s+([\d/]+)/i);
  return {
    name: field('NAME'),
    ic: field('IC / PASSPORT'),
    matric: field('MATRIC NUMBER'),
    program: field('PROGRAM'),
    semester: session ? `Sem ${session[1]} ${session[2]}` : null,
    courses,
  };
}

async function parseSlipPdf(buffer) {
  const { text } = await pdfParse(buffer);
  return parseSlipText(text);
}
module.exports = { parseSlipPdf, parseSlipText };
