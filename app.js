// PlasmaMemBRAIN v0.7.1
// Core: random molecule -> show structure + given properties -> student inputs -> check -> reveal -> next
// v0.6 changes ONLY (from working v0.5):
// (1) "Almost there…" uses v0.3 logic, but CORRECT/REVISE instead of emojis
// (2) Thresholds paragraph is handled in index.html (UI only)
// (3) Lipinski HBA = (#N + #O) from MolecularFormula (separate PubChem request; falls back safely)

let cidPool = [];
let current = null;
let isRevealed = false;
let streakAwarded = false; // prevents streak spam per molecule

let streak = 0;

const streakMessages = [
  "Ah, a fellow drug hunter!",
  "POLAR PANIC!!!",
  "Nrot or Not?",
  "Rotor Rumble",
  "Lead or Leave?",
  "Verber Verdict",
  "Are you the Professor?",
  "Enjoying 177?",
  "Pssst, ǝʇɐʇoɹ spuoq",
  "HighFive?",
  "Polar Explorer",
  "Easy on the grease",
  "Preclinical Prodigy",
  "Permeability Pro",
  "Bioavailable Boss"
];

function $(id) { return document.getElementById(id); }

function pickRandomMessage() {
  return streakMessages[Math.floor(Math.random() * streakMessages.length)];
}

function updateStreakDisplay() {
  $("streakCount").textContent = String(streak);
}

function parseIntOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function toggleCycle(btn) {
  const state = btn.dataset.state || "unset";
  if (state === "unset") {
    btn.dataset.state = "yes";
    btn.textContent = "✅";
    btn.classList.add("yes");
    btn.classList.remove("no");
  } else if (state === "yes") {
    btn.dataset.state = "no";
    btn.textContent = "❌";
    btn.classList.add("no");
    btn.classList.remove("yes");
  } else {
    btn.dataset.state = "unset";
    btn.textContent = "—";
    btn.classList.remove("yes", "no");
  }
}

function resetUIForNewMolecule() {
  isRevealed = false;
  streakAwarded = false;

  $("feedback").textContent = "";
  $("feedback").className = "feedback";

  // clear inputs
  ["hba_guess","hbd_guess","nrot_guess","hba_actual_guess","hbd_actual_guess"].forEach(id => {
    $(id).value = "";
    $(id).style.display = "inline-block";
    $(id).disabled = false;
  });

  // hide answers
  ["hba_ans","hbd_ans","nrot_ans","hba_actual_ans","hbd_actual_ans"].forEach(id => {
    $(id).style.display = "none";
    $(id).classList.remove("revealedNeon");
  });

  // reset toggles
  ["mw_toggle","xlogp_toggle","hba_toggle","hbd_toggle","nrot_toggle","tpsa_toggle"].forEach(id => {
    const b = $(id);
    b.dataset.state = "unset";
    b.textContent = "—";
    b.classList.remove("yes","no");
    b.disabled = false;
  });

  $("revealBtn").disabled = true;
}

async function loadCidPool() {
  cidPool = await fetch("./cid_pool_1000Da_50k.json").then(r => r.json());
}

function randomCid() {
  return cidPool[Math.floor(Math.random() * cidPool.length)];
}

function complianceExpectedFor(prop, value) {
  // thresholds used in v0.5/v0.6:
  // Lipinski: MW<=500, XLogP<=5, HBA<=10, HBD<=5
  // Veber: NRot<=10, TPSA<=140
  if (prop === "MW") return value <= 500;
  if (prop === "XLOGP") return value <= 5;
  if (prop === "HBA") return value <= 10;
  if (prop === "HBD") return value <= 5;
  if (prop === "NROT") return value <= 10;
  if (prop === "TPSA") return value <= 140;
  return false;
}

async function fetchProperties(cid) {
  // DO NOT CHANGE: keep v0.5 PubChem property call
  const props =
    "MolecularWeight,XLogP,HBondDonorCount,HBondAcceptorCount,RotatableBondCount,TPSA,IUPACName";
  const url =
    `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/property/${props}/JSON`;

  const data = await fetch(url).then(r => r.json());
  return data.PropertyTable.Properties[0];
}

async function fetchMolecularFormula(cid) {
  // Separate request so we do NOT destabilize structure loading.
  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/property/MolecularFormula/JSON`;
  const data = await fetch(url).then(r => r.json());
  return data.PropertyTable.Properties[0].MolecularFormula;
}

function computeLipinskiHBAFromFormula(formula) {
  // Lipinski RO5 teaching simplification: HBA ≈ (#N + #O)
  const nMatch = formula.match(/N(\d*)/);
  const oMatch = formula.match(/O(\d*)/);

  const nCount = nMatch ? (nMatch[1] === "" ? 1 : parseInt(nMatch[1], 10)) : 0;
  const oCount = oMatch ? (oMatch[1] === "" ? 1 : parseInt(oMatch[1], 10)) : 0;

  return nCount + oCount;
}

async function fetchBestName(cid, iupacFallback) {
  // Prefer a friendly synonym (often a common name)
  try {
    const synUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/synonyms/JSON`;
    const synData = await fetch(synUrl).then(r => r.json());
    const syns = synData?.InformationList?.Information?.[0]?.Synonym || [];
    if (syns.length > 0) return syns[0];
  } catch (e) {}
  return iupacFallback || "—";
}

function setGivenValues(c) {
  $("cid").textContent = c.CID;
  $("name").textContent = c.name;

  $("mw_val").textContent = Number(c.MolecularWeight).toFixed(2) + " g/mol";
  $("xlogp_val").textContent = (c.XLogP ?? "—");
  $("tpsa_val").textContent = (c.TPSA ?? "—") + " Å²";

  // ensure given values start non-revealed
  ["mw_val","xlogp_val","tpsa_val"].forEach(id => $(id).classList.remove("revealedNeon"));

  // image + pubchem link (v0.5 working behavior)
  $("structure").src = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${c.CID}/PNG`;
  $("pubchemLink").href = `https://pubchem.ncbi.nlm.nih.gov/compound/${c.CID}`;

  // store actuals (for logic)
  $("mw_val").dataset.actual = Number(c.MolecularWeight);
  $("xlogp_val").dataset.actual = Number(c.XLogP);
  $("tpsa_val").dataset.actual = Number(c.TPSA);

  // Lipinski table "answers" (datasets):
  // HBA uses Lipinski simplification (N+O), HBD/NRot use PubChem for now
  $("hba_ans").dataset.actual = Number(c.HBA_LRO5 ?? c.HBondAcceptorCount);
  $("hbd_ans").dataset.actual = Number(c.HBondDonorCount);
  $("nrot_ans").dataset.actual = Number(c.RotatableBondCount);

  // Actual Hydrogen Bonding (PubChem) datasets stay PubChem
  $("hba_actual_ans").dataset.actual = Number(c.HBondAcceptorCount);
  $("hbd_actual_ans").dataset.actual = Number(c.HBondDonorCount);
}

function getExpectedComplianceUsingActuals() {
  const mwV = Number(current.MolecularWeight);
  const xlogpV = Number(current.XLogP);
  const tpsaV = Number(current.TPSA);
  const hbaLipA = Number(current.HBA_LRO5 ?? current.HBondAcceptorCount);
  const hbdA = Number(current.HBondDonorCount);
  const nrotA = Number(current.RotatableBondCount);

  return {
    MW: complianceExpectedFor("MW", mwV),
    XLOGP: complianceExpectedFor("XLOGP", xlogpV),
    TPSA: complianceExpectedFor("TPSA", tpsaV),
    HBA: complianceExpectedFor("HBA", hbaLipA),
    HBD: complianceExpectedFor("HBD", hbdA),
    NROT: complianceExpectedFor("NROT", nrotA)
  };
}

function getUserComplianceStates() {
  function state(btnId){
    const s = $(btnId).dataset.state;
    if (s === "yes") return true;
    if (s === "no") return false;
    return null;
  }
  return {
    MW: state("mw_toggle"),
    XLOGP: state("xlogp_toggle"),
    HBA: state("hba_toggle"),
    HBD: state("hbd_toggle"),
    NROT: state("nrot_toggle"),
    TPSA: state("tpsa_toggle")
  };
}

function evaluateRound() {
  // Returns per-field correctness booleans + overall
  const hbaG = parseIntOrNull($("hba_guess").value);
  const hbdG = parseIntOrNull($("hbd_guess").value);
  const nrotG = parseIntOrNull($("nrot_guess").value);
  const hbaActG = parseIntOrNull($("hba_actual_guess").value);
  const hbdActG = parseIntOrNull($("hbd_actual_guess").value);

  const hbaLipA = Number(current.HBA_LRO5 ?? current.HBondAcceptorCount);
  const hbaPubA = Number(current.HBondAcceptorCount);
  const hbdA = Number(current.HBondDonorCount);
  const nrotA = Number(current.RotatableBondCount);

  // Value correctness (required)
  const val_ok = {
    HBA: (hbaG !== null && hbaG === hbaLipA),
    HBD: (hbdG !== null && hbdG === hbdA),
    NRot: (nrotG !== null && nrotG === nrotA),
    HBA_actual: (hbaActG !== null && hbaActG === hbaPubA),
    HBD_actual: (hbdActG !== null && hbdActG === hbdA)
  };

  const allValuesOk = val_ok.HBA && val_ok.HBD && val_ok.NRot && val_ok.HBA_actual && val_ok.HBD_actual;

  // Compliance correctness (required for all toggles)
  const expected = getExpectedComplianceUsingActuals();
  const user = getUserComplianceStates();

  const comp_ok = {
    MW: (user.MW !== null && user.MW === expected.MW),
    cLogP: (user.XLOGP !== null && user.XLOGP === expected.XLOGP),
    HBA: (user.HBA !== null && user.HBA === expected.HBA),
    HBD: (user.HBD !== null && user.HBD === expected.HBD),
    NRot: (user.NROT !== null && user.NROT === expected.NROT),
    TPSA: (user.TPSA !== null && user.TPSA === expected.TPSA)
  };

  const allComplianceOk =
    comp_ok.MW && comp_ok.cLogP && comp_ok.HBA && comp_ok.HBD && comp_ok.NRot && comp_ok.TPSA;

  return {
    val_ok,
    comp_ok,
    perfect: allValuesOk && allComplianceOk
  };
}

function formatAlmostThereMessage(result) {
  // v0.6: revert to v0.3 feedback logic, but use CORRECT / REVISE instead of emojis.
  // Must include: value for HBA,HBD,NRot and compliance for MW,cLogP,HBA,HBD,NRot,TPSA
  const v = result.val_ok;
  const c = result.comp_ok;

  const valueLines = [
    `HBA ${v.HBA ? "CORRECT" : "REVISE"}`,
    `HBD ${v.HBD ? "CORRECT" : "REVISE"}`,
    `NRot ${v.NRot ? "CORRECT" : "REVISE"}`
  ];

  const compLines = [
    `MW ${c.MW ? "CORRECT" : "REVISE"}`,
    `cLogP ${c.cLogP ? "CORRECT" : "REVISE"}`,
    `HBA ${c.HBA ? "CORRECT" : "REVISE"}`,
    `HBD ${c.HBD ? "CORRECT" : "REVISE"}`,
    `NRot ${c.NRot ? "CORRECT" : "REVISE"}`,
    `TPSA ${c.TPSA ? "CORRECT" : "REVISE"}`
  ];

  return `Almost there… revise:\n\nValue:\n• ${valueLines.join("\n• ")}\n\nCompliance:\n• ${compLines.join("\n• ")}`;
}

function checkCorrectness() {
  if (!current) return;
  if (isRevealed) return;

  const result = evaluateRound();

  const pubchemLine = `\n\nPubChem HBA_actual: ${Number(current.HBondAcceptorCount)} · HBD_actual: ${Number(current.HBondDonorCount)}`;

  if (result.perfect) {
    $("feedback").textContent = `All Correct! ${pickRandomMessage()}`
    $("feedback").className = "feedback ok";
    $("revealBtn").disabled = true;

    if (!streakAwarded) {
      streak += 1;
      streakAwarded = true;
      updateStreakDisplay();
    }
  } else {
    $("feedback").textContent = formatAlmostThereMessage(result) + pubchemLine;
    $("feedback").className = "feedback warn";
    $("revealBtn").disabled = false;
  }
}

function revealAnswer() {
  if (!current) return;
  isRevealed = true;

  // Style given properties (MW, cLogP, TPSA) in neon
  ["mw_val","xlogp_val","tpsa_val"].forEach(id => $(id).classList.add("revealedNeon"));

  function replaceInputWithAns(inputId, ansId, val) {
    const input = $(inputId);
    const ans = $(ansId);

    input.style.display = "none";
    input.disabled = true;

    ans.textContent = String(val);
    ans.style.display = "inline";
    ans.classList.add("revealedNeon");
  }

  replaceInputWithAns("hba_guess", "hba_ans", Number($("hba_ans").dataset.actual));
  replaceInputWithAns("hbd_guess", "hbd_ans", Number($("hbd_ans").dataset.actual));
  replaceInputWithAns("nrot_guess", "nrot_ans", Number($("nrot_ans").dataset.actual));
  replaceInputWithAns("hba_actual_guess", "hba_actual_ans", Number($("hba_actual_ans").dataset.actual));
  replaceInputWithAns("hbd_actual_guess", "hbd_actual_ans", Number($("hbd_actual_ans").dataset.actual));

  // Disable compliance toggles after reveal
  ["mw_toggle","xlogp_toggle","hba_toggle","hbd_toggle","nrot_toggle","tpsa_toggle"].forEach(id => {
    const b = $(id);
    b.disabled = true;
  });

  $("feedback").textContent = "Answer revealed.";
  $("feedback").className = "feedback info";
  $("revealBtn").disabled = true;
}

async function nextMolecule() {
  resetUIForNewMolecule();

  for (let tries = 0; tries < 12; tries++) {
    const cid = randomCid();
    try {
      const p = await fetchProperties(cid);

      // Ensure required fields exist (skip weird/incomplete entries)
      if (p.MolecularWeight === undefined || p.XLogP === undefined || p.TPSA === undefined) continue;
      if (p.HBondAcceptorCount === undefined || p.HBondDonorCount === undefined || p.RotatableBondCount === undefined) continue;

      const name = await fetchBestName(cid, p.IUPACName);

      // Keep v0.5 behavior (working) and add ONLY v0.6 HBA_LRO5
      current = { ...p, CID: cid, name };

      // Lipinski HBA = (#N + #O) from MolecularFormula (safe separate request)
      try {
        const formula = await fetchMolecularFormula(cid);
        current.HBA_LRO5 = computeLipinskiHBAFromFormula(formula);
      } catch (e) {
        // fallback: don't break app if formula call fails
        current.HBA_LRO5 = Number(p.HBondAcceptorCount);
      }

      setGivenValues(current);
      return;
    } catch (e) {
      // try another CID
    }
  }

  $("feedback").textContent = "Could not load a molecule—try again.";
  $("feedback").className = "feedback warn";
}

function wireToggles() {
  document.querySelectorAll(".toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      if (isRevealed) return;
      toggleCycle(btn);
    });
  });
}

window.addEventListener("load", async () => {
  updateStreakDisplay();
  await loadCidPool();
  wireToggles();

  $("checkBtn").addEventListener("click", checkCorrectness);
  $("revealBtn").addEventListener("click", revealAnswer);
  $("nextBtn").addEventListener("click", nextMolecule);

  nextMolecule();
});
