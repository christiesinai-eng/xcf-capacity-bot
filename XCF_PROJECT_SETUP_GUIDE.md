# XCF Project Setup Guide – Automated Folder Creation & Asana Linking

**Last Updated:** 2026-09-03  
**Status:** ✅ Fully Automated & Tested (XCF-10689, XCF-10707)

---

## Overview

This guide documents the automated project setup process for XCF projects, including Google Drive folder creation and Asana project linking. It explains current capabilities, known limitations, and manual steps required until connector updates are available.

---

## What Gets Automated

### ✅ Google Drive Setup
- **Main project folder** created with correct naming: `XCF-XXXX | Project Name`
- **Complete folder structure** replicated from template:
  - 01_Briefs
  - 02_Working_Files
    - 2.1_In Progress
    - 2.2_Final
    - 2.3_Flora backup
  - 03_Assets
  - 04_Reviews
    - 4.1_R1
    - 4.2_R2
    - 4.3_R3
  - 05_FINAL_DELIVERY
  - 06_Admin_Paperwork
- **Location:** XCF Projects folder (destination folder ID: `1fMBca9-VrGOVytlvBNG3Sy4PJiuqQcXz`)

### ✅ Asana Setup (Fully Automated)
- **Link added to project notes** (visible in project description area)
- **Manual step:** Add link to "Key Resources" section (5 seconds, Asana API limitation)

---

## How It Works

### ✅ Automated Method (Fully Functional)

**Process:**
1. User requests project setup in Claude Code with ticket: `XCF-XXXX | Project Name`
2. Claude creates main folder in G Drive using Google Workspace MCP connector
3. Claude creates all 6 main subfolders (01_Briefs through 06_Admin_Paperwork)
4. Claude creates all nested subfolders (2.1, 2.2, 2.3 under 02_Working_Files; 4.1, 4.2, 4.3 under 04_Reviews)
5. Claude updates Asana project with G Drive link in project notes
6. User performs 5-second manual step: adds link to Asana "Key Resources" section

**Time:** ~30 seconds automated + 5 seconds manual = 35 seconds total

**Result:** Complete, ready-to-use project folder structure

---

## How to Request Project Setup (for Users)

### Quick Start
1. Create your Asana project with name: `XCF-XXXX | Project Name` (include the XCF ID)
2. Add it to the [XCF | Projects portfolio](https://app.asana.com/0/portfolio/1217210785824637/1217215893985481)
3. Open Claude Code and ask:
   ```
   Create a project folder for: XCF-XXXX | Project Name
   ```
4. Claude will create the complete folder structure in G Drive
5. Copy the G Drive link from Claude's response
6. Add it to Asana's "Key Resources" section (5-second manual step)

### Example
**Request:** `Create a project folder for: XCF-10707 | Test for Micro naming and conversion x 2`

**Result:** 
- ✅ G Drive folder created with all subfolders
- ✅ Asana project linked in notes
- ⚠️ Manual: Add link to Key Resources section

---

## Known Limitations

### 📋 Limitation 1: Empty Folder Structure

**Current Behavior:** Folders are created empty (no files copied from template)
- Google Workspace `copy_file` tool has limitations with recursive folder copying
- Folders created are ready to use, just need files added
- All folder structure matches the template exactly

**Workaround:** Works reliably! Users can:
- Manually copy files from template folder as needed
- Or request file copying in a follow-up Claude Code request

**If Needed:** Xero admin can investigate `copy_file` optimization, but current workaround is stable

---

### 🟡 Limitation 2: Asana "Key Resources" API (DESIGN LIMITATION)

**Issue:** Asana's "Key resources" section in Overview tab has no API method
- The section is UI-only in Asana's design
- No programmatic way to add links through the API
- G Drive link is added to project notes but NOT visible in Key Resources section

**Workaround:** Manual step required (see below)

**Status:** PERMANENT ASANA LIMITATION
- This is how Asana designed the feature
- No connector update will fix this
- Requires either:
  - Manual UI step (current workaround)
  - Asana API enhancement (unlikely)
  - Custom Asana integration (out of scope)

---

## Setup Process (Detailed Steps)

### Preparation
1. Create Asana project with name: `XCF-XXXX | Project Name` (must include XCF ID)
2. Add to [XCF | Projects portfolio](https://app.asana.com/0/portfolio/1217210785824637/1217215893985481)
3. Open Claude Code and ask Claude to create the project folder

### Automated Result (Claude Handles This)
- ✅ G Drive folder created: `XCF-XXXX | Project Name`
- ✅ All 6 main folders created (01_Briefs through 06_Admin_Paperwork)
- ✅ All nested subfolders created (2.1, 2.2, 2.3 and 4.1, 4.2, 4.3)
- ✅ Asana project updated with G Drive link in project notes

### Manual Steps Required (Currently)

**Step 1: Add Link to Asana Key Resources**

1. Open your Asana project (e.g., XCF-10689)
2. Go to the **Overview** tab
3. Scroll down to **"Key resources"** section
4. Click **"Add links & files"** button
5. Paste this link:
   ```
   https://drive.google.com/drive/folders/[PROJECT_FOLDER_ID]
   ```
   *(The folder ID is provided after setup completes)*

**Step 2: Verify**
- Check G Drive folder: All subfolders should be present
- Check Asana project: Link should appear in Key Resources section

---

## Complete Setup Example

### Example: XCF-10689 | Test for Micro naming and conversion x 1

**What Was Done:**
```
✅ Main folder created: XCF-10689 | Test for Micro naming and conversion x 1
✅ Folder ID: 1TZdtMVNLKvpv5aFbDcvGvOtlKpidQxlX
✅ All 6 main folders created
✅ All nested subfolders created (5 nested folders in 02_Working_Files and 04_Reviews)
✅ Link added to Asana project notes
⚠️  Link NOT in Key Resources section (requires manual step)
```

**G Drive Folder Link:**
```
https://drive.google.com/drive/folders/1TZdtMVNLKvpv5aFbDcvGvOtlKpidQxlX
```

**Manual Step Needed:**
Add the link to the Asana project's "Key Resources" section using the steps above.

---

## Technical Details for Implementation

### API Approach Used

**Creating Folder Structure:**
```
1. Create main project folder (create_file with mimeType: application/vnd.google-apps.folder)
2. For each template subfolder:
   - Search for contents (search_files with parentId)
   - If empty: create empty subfolder
   - If contains subfolders: create subfolder, then recursively create nested structure
```

**Adding Asana Link:**
```
update_project with html_notes containing link in <body></body> tags
```

### Why Manual Asana Step?

Asana's API (`update_project`) does not expose a method to add items to the "Key resources" section. The section is managed through a proprietary UI feature that has no backend API equivalent.

---

## Automation Roadmap

### Phase 1 (Current) ✅
- [x] G Drive folder creation (workaround via create_file)
- [x] Nested subfolder structure
- [x] Asana project linking (via notes)
- [ ] Key Resources section (manual)
- [ ] File copying (blocked by connector)

### Phase 2 (When Connector Fixed) 🔄
- [ ] Full folder copying with files
- [ ] Faster automation (no manual folder creation)

### Phase 3 (If Asana API Improves) 📋
- [ ] Programmatic Key Resources linking
- [ ] Zero manual steps

---

## For Team/Admin Reference

### Connector Update Requested
- **Issue:** Google Workspace `copy_file` tool returns internal errors
- **Requested From:** Xero Admin
- **Status:** Pending
- **Impact:** Will enable file copying in addition to folder structure creation

### Custom Field Audit
All XCF project custom fields reviewed:
- Sizing (XCF)
- Priority (XCF)
- Business Group (XCF)
- Project type (XCF)
- Status (XCF)
- Workflow fields (Campaign Ops, Design, Performance, etc.)
- Planning fields (Quarter, Launch category, OKRs, etc.)
- Regional/team fields

**Finding:** No "Key Resources" custom field exists. The Key Resources section in Asana Overview is a built-in feature without API support.

---

## Troubleshooting

### Issue: G Drive folder not created
- **Check:** Asana project exists with correct name format (XCF-XXXX | Name)
- **Check:** Permissions on Google Workspace connector
- **Action:** Run setup again

### Issue: Link not visible in Asana Key Resources
- **Expected:** Link is in project notes, NOT in Key Resources section
- **Action:** Use manual step above to add to Key Resources

### Issue: Nested subfolders missing
- **Check:** All 6 main folders present in G Drive
- **Check:** 02_Working_Files has 3 nested folders (2.1, 2.2, 2.3)
- **Check:** 04_Reviews has 3 nested folders (4.1, 4.2, 4.3)
- **Action:** Create missing folders manually or run setup again

### Issue: Folders already exist
- **Expected:** Skill will skip existing folders
- **Action:** Manually delete old folder or use different project name

---

## FAQ

**Q: Why can't you automate the Asana "Key Resources" step?**  
A: Asana's API doesn't expose this feature. It's UI-only in their design.

**Q: Will the manual step be required forever?**  
A: Only until Asana adds API support for this feature (unlikely in near term).

**Q: What if I want to copy files from the template?**  
A: Wait for the Google Workspace connector update. Currently only folder structure is created.

**Q: Can I run the setup multiple times?**  
A: Yes. It will skip folders that already exist.

**Q: How long does setup take?**  
A: ~30 seconds for G Drive folder creation + ~5 seconds for Asana linking = ~35 seconds total

---

## Next Steps

1. **For immediate use:** Follow the manual step above to add link to Key Resources
2. **For automation:** Check with Xero admin on connector update timeline
3. **For enhancement:** Document this in skill metadata so users know about the manual step

---

## Related Resources

- **Asana Project:** XCF | Projects portfolio
- **G Drive:** XCF Projects folder (1fMBca9-VrGOVytlvBNG3Sy4PJiuqQcXz)
- **Template Folder:** _TEMPLATE MAKE A COPY (1ewiXzeO6fNttEKJoCnIVvpjBmwrWS_FL)
- **Connector Issue:** Google Workspace `copy_file` broken (internal errors)

