'use strict';
// Prints the formulas that turn Glean_Regional_Raw (one row per request) into the four Regional tabs.
// The sheet counts; the agent only copies. Run: node scripts/regional-formulas.js > formulas.json
const R = 'Glean_Regional_Raw';
const C = 'Glean_Regional_Calc';
const RNG = (col) => `${R}!$${col}$2:$${col}$2000`;
const CNG = (col) => `$${col}$2:$${col}$2000`;
const ARNG = (col) => `${C}!$${col}$2:$${col}$2000`;

// ── Calc tab: one derived column per idea, each spilling down from row 1 (header + values in one formula) ──
const calc = {
  A1: `={"quarter";ARRAYFORMULA(IF(${R}!C2:C2000="","","FY"&TEXT(MOD(VALUE(LEFT(${R}!C2:C2000,4))+IF(VALUE(MID(${R}!C2:C2000,6,2))>=4,1,0),100),"00")&" Q"&(INT(MOD(VALUE(MID(${R}!C2:C2000,6,2))+8,12)/3)+1)))}`,
  B1: `={"live";ARRAYFORMULA(IF(${R}!A2:A2000="","",IF(${R}!D2:D2000="Cancelled",0,IF((A2:A2000=$I$1)+(A2:A2000=$I$2)>0,1,0))))}`,
  C1: `={"cost_code";ARRAYFORMULA(IF(${R}!A2:A2000="","",IFERROR(REGEXEXTRACT(${R}!I2:I2000,"^\\s*(\\d{3,4})\\b"),"")))}`,
  D1: `={"month";ARRAYFORMULA(IF(${R}!A2:A2000="","",LEFT(${R}!C2:C2000,7)))}`,
  E1: `={"has_type";ARRAYFORMULA(IF(${R}!A2:A2000="","",IF(${R}!E2:E2000<>"",1,0)))}`,
  F1: `={"unrecognised";ARRAYFORMULA(IF(${R}!A2:A2000="","",IF((B2:B2000=1)*(${R}!I2:I2000<>"")*(C2:C2000="")=1,1,0)))}`,
};

// ── label blocks: (quarter, label) pairs, one per request value, for each type x dimension ──
const SECTIONS = [
  { type: 'Roadmap',     dim: 'Region',         source: 'Applicable Regions',   col: 'F', blk: ['K', 'L'] },
  { type: 'Roadmap',     dim: 'Business Group', source: 'Business Group (XCF)', col: 'H', blk: ['M', 'N'] },
  { type: 'Roadmap',     dim: 'Cost Centre',    source: 'SH Cost centre (XCF)', col: 'C', blk: ['O', 'P'], calc: true },
  { type: 'Micro (BAU)', dim: 'Region',         source: 'Regions (XCF)',        col: 'G', blk: ['Q', 'R'] },
  { type: 'Micro (BAU)', dim: 'Business Group', source: 'Business Group (XCF)', col: 'H', blk: ['S', 'T'] },
  { type: 'Micro (BAU)', dim: 'Cost Centre',    source: 'SH Cost centre (XCF)', col: 'C', blk: ['U', 'V'], calc: true },
];
const valRange = (s) => (s.calc ? CNG(s.col) : RNG(s.col));
const filt = (s, what) => `FILTER(${what},${CNG('B')}=1,${RNG('E')}="${s.type}",${valRange(s)}<>"")`;

function blockFormula(s) {
  const q = filt(s, CNG('A'));
  const v = filt(s, valRange(s));
  if (s.dim === 'Region') {
    return `=IFERROR(LET(q,${q},s,${v},j,TEXTJOIN("¦",TRUE,MAP(q,s,LAMBDA(a,b,a&"|"&REGEXREPLACE(b,"\\s*;\\s*","¦"&a&"|")))),ARRAYFORMULA(TRIM(SPLIT(TRANSPOSE(SPLIT(j,"¦")),"|")))),{"",""})`;
  }
  return `=IFERROR(LET(q,${q},b,${v},HSTACK(q,ARRAYFORMULA(TRIM(b)))),{"",""})`;
}
const blocks = {};
SECTIONS.forEach((s) => { blocks[`${s.blk[0]}2`] = blockFormula(s); });

// ── Regional: count per label, in the build's order (section, quarter, count high to low, label) ──
function regionalFormula() {
  const parts = SECTIONS.map((s) => {
    const rng = `${C}!${s.blk[0]}2:${s.blk[1]}2000`;
    // QUERY always puts a label row first: FILTER drops it. IF(SEQUENCE(n)>0, ...) inside ARRAYFORMULA repeats a constant down n rows.
    const q = `QUERY(${rng},"select Col1, Col2, count(Col2) where Col2 <> '' group by Col1, Col2 order by Col1, count(Col2) desc, Col2",0)`;
    const rep = (v) => `ARRAYFORMULA(IF(SEQUENCE(n)>0,"${v}"))`;
    return `IFERROR(LET(q,${q},r,FILTER(q,SEQUENCE(ROWS(q))>1),n,ROWS(r),HSTACK(${rep(s.type)},${rep(s.dim)},${rep(s.source)},r)),{"","","","","",""})`;
  });
  return `=QUERY(VSTACK(${parts.join(',')}),"select * where Col1 <> ''",0)`;
}

// ── Regional_Panels: 12 fixed rows ──
function panelRows() {
  const rows = [];
  SECTIONS.forEach((s, si) => {
    [1, 2].forEach((qn) => {
      const row = rows.length + 2;
      const qcell = `${C}!$I$${qn}`;
      const base = `${RNG('E')},$A${row},${ARNG('B')},1,${ARNG('A')},$D${row}`;
      const withValue = s.calc
        ? `COUNTIFS(${base},${ARNG('C')},"?*")`
        : `COUNTIFS(${base},${RNG(s.col)},"?*")`;
      const pair = qn === 1 ? [row, row + 1] : [row - 1, row];
      rows.push([
        s.type, s.dim, s.source, `=${qcell}`,
        `=COUNTIFS(${C}!$${s.blk[0]}$2:$${s.blk[0]}$2000,$D${row},${C}!$${s.blk[1]}$2:$${s.blk[1]}$2000,"?*")`,
        `=${withValue}`,
        `=H${row}-F${row}`,
        `=COUNTIFS(${base})`,
        `=AND(F${pair[0]}<=1,F${pair[1]}<=1)`,
      ]);
    });
  });
  return rows;
}

// ── Regional_Unrecognised ──
const unrec = `=IFERROR(LET(g,FILTER(${RNG('A')},${ARNG('F')}=1),n,FILTER(${RNG('B')},${ARNG('F')}=1),w,FILTER(${RNG('I')},${ARNG('F')}=1),q,FILTER(${ARNG('A')},${ARNG('F')}=1),t,FILTER(${RNG('E')},${ARNG('F')}=1),SORT(HSTACK(g,n,ARRAYFORMULA(LEFT(REGEXREPLACE(w,"^\\s+|\\s+$",""),80)),q,ARRAYFORMULA(IF(t="","Unset",t)),ARRAYFORMULA("https://app.asana.com/1/41261904390129/project/1215906401561993/task/"&g)),3,TRUE)),{"","","","","",""})`;
// Column order of the tab is gid, name, raw_value, quarter, request_type, url: matches the HSTACK above.

// ── Regional_Meta ──
const meta = `=LET(` +
  `qs,{"quarter",${C}!$I$1,"","";"quarter",${C}!$I$2,"",""},` +
  `m,IFERROR(SORT(UNIQUE(FILTER(${ARNG('D')},${ARNG('B')}=1))),""),` +
  `tc,IFERROR(HSTACK(ARRAYFORMULA(IF(m<>"","type_completion","")),m,ARRAYFORMULA(COUNTIFS(${ARNG('D')},m,${ARNG('B')},1)),ARRAYFORMULA(ROUND(COUNTIFS(${ARNG('D')},m,${ARNG('B')},1,${ARNG('E')},1)/COUNTIFS(${ARNG('D')},m,${ARNG('B')},1)*100,0))),{"","","",""}),` +
  `bq,{"by_quarter",${C}!$I$1,COUNTIFS(${ARNG('A')},${C}!$I$1,${ARNG('B')},1),"";"by_quarter",${C}!$I$2,COUNTIFS(${ARNG('A')},${C}!$I$2,${ARNG('B')},1),""},` +
  `tt,{"total","totalInWindow",COUNTIF(${ARNG('B')},1),"";` +
  `"total","cancelledExcluded",COUNTIFS(${RNG('D')},"Cancelled",${ARNG('A')},${C}!$I$1)+COUNTIFS(${RNG('D')},"Cancelled",${ARNG('A')},${C}!$I$2),"";` +
  `"total","typeUnset",COUNTIFS(${ARNG('B')},1,${ARNG('E')},0),"";` +
  `"total","unrecognisedCount",COUNTIF(${ARNG('F')},1),""},` +
  `QUERY(VSTACK(qs,tc,bq,tt),"select * where Col1 <> ''",0))`;

module.exports = { calc, blocks, regional: regionalFormula(), panels: panelRows(), unrec, meta };
if (require.main === module) process.stdout.write(JSON.stringify(module.exports, null, 1));
