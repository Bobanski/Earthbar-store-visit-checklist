/* templates-data.js — Worker B (templates + admin)
   Canonical template CONTENT, registered with Data.registerTemplates() at eval time.
   Defines the 7 templates in CORE_TEMPLATE_IDS (core.js). Do not touch localStorage
   directly — this module only builds plain data and calls Data.registerTemplates().

   ---------------------------------------------------------------------------
   SCHEMA (mirrors SPEC.md "Data model" — templates collection):

   Template = {
     id: string,                              // stable, kebab-case
     name: string,                            // display name
     cadence: 'adhoc'|'daily'|'weekly'|'monthly'|'quarterly',
     window?: { startHH: number, endHH: number },   // time-lock; endHH < startHH = overnight
     requiresOnsite: boolean,                 // geolocation gate in the runner
     scored: boolean,
     thresholds?: { A: number, B: number, C: number },  // percent cutoffs, grade floor
     rotatingThemes?: string[],               // ISO-week-rotated theme labels (Sched.rotatingTheme)
     sections: [{
       id: string,
       title: string,
       requirePhoto: boolean,                 // section-level photo requirement
       theme?: string,                        // present only on rotating-theme sections;
                                               // must match one entry in rotatingThemes verbatim
       items: [{
         id: string,
         text: string,
         type: 'passfail'|'rating'|'text',
         critical?: boolean,                  // fails template regardless of score
         allowNA?: boolean,
       }]
     }]
   }

   CORE templates (store-visit, daily-open/mid/close, oea-audit, health-code,
   travel-path) are matched by id against CORE_TEMPLATE_IDS in core.js so seeded
   submission history lines up. Admin edits to a core template are stored as an
   override (Data.saveTemplate -> db.templateOverrides[id]); Data.resetTemplate(id)
   clears it back to this file's definition. Admin-created templates (new ids) live
   in db.customTemplates instead and are fully removable.
   ---------------------------------------------------------------------------
*/

'use strict';

  /* ---- store-visit: ported from earthbar-store-visit.html CATEGORIES (~L630-749).
     Emoji stripped per SPEC design rule. noPhoto -> requirePhoto:false. critical flags
     kept. Weekly Focus (focusKey) -> 4 sections tagged {theme:'...'} under rotatingThemes;
     the runner shows only the current ISO-week theme's section (Sched.rotatingTheme). */
  const storeVisit = {
    id: 'store-visit',
    name: 'DL Store Visit',
    cadence: 'adhoc',
    requiresOnsite: true,
    scored: true,
    thresholds: { A: 90, B: 75, C: 60 },
    rotatingThemes: ['Team Focus', 'Guest Focus', 'Financial Focus', 'Store Focus'],
    sections: [
      { id: 'connection', title: 'Connection', requirePhoto: false, items: [
        { id: 'c1', text: 'Connected with a team member and learned something new about them', type: 'passfail' },
        { id: 'c2', text: 'Discussed Thoughtful Tuesday / Thursday Pulse / CEO Message', type: 'passfail' },
      ]},
      { id: 'curbside', title: 'Curbside', requirePhoto: true, items: [
        { id: 'cs1', text: 'Exterior is clean (no trash or debris)', type: 'passfail' },
        { id: 'cs2', text: 'Signage is visible and in good condition', type: 'passfail' },
        { id: 'cs3', text: 'Hours are posted and accurate', type: 'passfail' },
      ]},
      { id: 'lobby', title: 'Lobby', requirePhoto: true, items: [
        { id: 'l1', text: 'Lobby is clean and organized', type: 'passfail' },
        { id: 'l2', text: 'POP / marketing materials are current', type: 'passfail' },
      ]},
      { id: 'pos', title: 'POS', requirePhoto: false, items: [
        { id: 'p1', text: 'POS system is functioning correctly', type: 'passfail' },
        { id: 'p2', text: 'Pricing displayed is accurate', type: 'passfail' },
        { id: 'p3', text: 'Loyalty program prompts are working at checkout', type: 'passfail' },
      ]},
      { id: 'bar', title: 'Bar', requirePhoto: true, items: [
        { id: 'b1', text: 'Equipment is clean (blenders, surfaces)', type: 'passfail' },
        { id: 'b2', text: 'Build guides are posted and visible', type: 'passfail' },
        { id: 'b3', text: 'Proper food handling observed (gloves, hygiene)', type: 'passfail', critical: true },
        { id: 'b4', text: 'Temperature logs are current', type: 'passfail' },
        { id: 'b5', text: 'Ingredients are stocked and properly stored', type: 'passfail' },
      ]},
      { id: 'handoff', title: 'Handoff', requirePhoto: true, items: [
        { id: 'h1', text: 'Handoff area is clean and organized', type: 'passfail' },
        { id: 'h2', text: 'Orders are being called correctly', type: 'passfail' },
        { id: 'h3', text: 'Wait times are acceptable', type: 'passfail' },
      ]},
      { id: 'boh', title: 'BOH / Comm Board', requirePhoto: true, items: [
        { id: 'boh1', text: "Comm board is updated with current week's information", type: 'passfail' },
        { id: 'boh2', text: 'Walk-in cooler is organized', type: 'passfail' },
        { id: 'boh3', text: 'Cleaning schedule is posted and being followed', type: 'passfail' },
      ]},
      { id: 'retail', title: 'Retail Planogram', requirePhoto: true, items: [
        { id: 'r1', text: 'Planogram compliance — shelves match the diagram', type: 'passfail' },
        { id: 'r2', text: 'Product facing is correct (labels out, shelves pulled forward)', type: 'passfail' },
        { id: 'r3', text: 'Pricing is accurate on all retail items', type: 'passfail' },
      ]},
      { id: 'opscheck', title: 'Operations Check', requirePhoto: false, items: [
        { id: 'oc1', text: 'Redbook is complete and compliant', type: 'passfail' },
        { id: 'oc2', text: 'Integrity review completed with GM / TM', type: 'passfail' },
        { id: 'oc3', text: 'Previous visit action items have been reviewed', type: 'passfail' },
      ]},
      { id: 'focus_team', title: 'Weekly Focus — Team', requirePhoto: false, theme: 'Team Focus', items: [
        { id: 'ft1', text: 'Reviewed "T" score on KPI Scorecard with GM', type: 'passfail' },
        { id: 'ft2', text: 'Reviewed calling card / IDP progress with GM or TM', type: 'passfail' },
        { id: 'ft3', text: 'Succession planning and scheduling discussed', type: 'passfail' },
      ]},
      { id: 'focus_guest', title: 'Weekly Focus — Guest', requirePhoto: false, theme: 'Guest Focus', items: [
        { id: 'fg1', text: 'GREAT Guest Service audit completed', type: 'passfail' },
        { id: 'fg2', text: 'Reviewed marketing scorecard (service metrics, loyalty capture)', type: 'passfail' },
        { id: 'fg3', text: 'Build guide compliance confirmed at the bar', type: 'passfail' },
      ]},
      { id: 'focus_financial', title: 'Weekly Focus — Financial', requirePhoto: false, theme: 'Financial Focus', items: [
        { id: 'ff1', text: 'P&L recap reviewed with GM', type: 'passfail' },
        { id: 'ff2', text: 'Repair and maintenance tickets are submitted and up to date', type: 'passfail' },
        { id: 'ff3', text: 'Scheduling reviewed for the next 3 weeks', type: 'passfail' },
      ]},
      { id: 'focus_store', title: 'Weekly Focus — Store', requirePhoto: false, theme: 'Store Focus', items: [
        { id: 'fs1', text: 'OEA mock / prep audit completed', type: 'passfail' },
        { id: 'fs2', text: 'Food handlers, POP, and planograms checked', type: 'passfail' },
        { id: 'fs3', text: 'Deep cleaning schedule reviewed and on track', type: 'passfail' },
      ]},
    ],
  };

  /* ---- Redbook dailies — REAL content from Augie's REDBOOK (Final).docx (2026-09-16,
     Teams). Source is one daily page repeated 7x (a week); day-rotating elements
     (deep cleaning, PEOPLE/PROCESS/PRODUCT reflections) are day-labeled items with
     allowNA since the schema rotates sections by ISO week, not weekday. Temp-log
     duplicate equipment rows (source print layout) deduped. */
  const dailyOpen = {
    id: 'daily-open',
    name: 'Daily Opening (Redbook)',
    cadence: 'daily',
    window: { startHH: 5, endHH: 11 },
    requiresOnsite: false,
    scored: false,
    sections: [
      { id: 'shift-roster-goals', title: 'Shift Roster & Goals', requirePhoto: false, items: [
        { id: 'op1', text: 'Period:_____ Week:_____ Date:____________ Day of Week:_______________ Daily Numbers:', type: 'text' },
        { id: 'op2', text: 'Opening Lead:', type: 'text' },
        { id: 'op3', text: 'Meal Break:', type: 'text' },
        { id: 'op4', text: 'Shift Focus:', type: 'text' },
        { id: 'op5', text: 'Sales Goal:$__________________', type: 'text' },
        { id: 'op6', text: 'Stretch Goal:$________________', type: 'text' },
        { id: 'op7', text: 'Check Avg Goal:$_____________', type: 'text' },
        { id: 'op8', text: 'App Goal:____________________', type: 'text' },
        { id: 'op9', text: 'Mid TM(s): /', type: 'text' },
        { id: 'op10', text: 'Meal Break(s): /', type: 'text' },
        { id: 'op11', text: 'Shift Focus:', type: 'text' },
        { id: 'op12', text: 'Sales Goal:$__________________', type: 'text' },
        { id: 'op13', text: 'Stretch Goal:$________________', type: 'text' },
        { id: 'op14', text: 'Check Avg Goal:$_____________', type: 'text' },
        { id: 'op15', text: 'App Goal:____________________', type: 'text' },
        { id: 'op16', text: 'Mid TM(s): /', type: 'text' },
        { id: 'op17', text: 'Meal Break(s): /', type: 'text' },
        { id: 'op18', text: 'Shift Focus:', type: 'text' },
        { id: 'op19', text: 'Sales Goal:$__________________', type: 'text' },
        { id: 'op20', text: 'Stretch Goal:$________________', type: 'text' },
        { id: 'op21', text: 'Check Avg Goal:$_____________', type: 'text' },
        { id: 'op22', text: 'App Goal:____________________', type: 'text' },
        { id: 'op23', text: 'Closing Lead:', type: 'text' },
        { id: 'op24', text: 'Meal Break:', type: 'text' },
        { id: 'op25', text: 'Shift Focus:', type: 'text' },
        { id: 'op26', text: 'Sales Goal:$__________________', type: 'text' },
        { id: 'op27', text: 'Stretch Goal:$________________', type: 'text' },
        { id: 'op28', text: 'Check Avg Goal:$_____________', type: 'text' },
        { id: 'op29', text: 'App Goal:____________________', type: 'text' },
      ]},
      { id: 'opening-checklist', title: 'Opening Checklist', requirePhoto: false, items: [
        { id: 'op30', text: '1. Clock-In + Set Up: Retail (Shelf, Cooler, & Counter) + A-frame/ Signage in Place + Bring out Furniture (Street Stores)', type: 'passfail' },
        { id: 'op31', text: '6. Wipe Down / Sanitize ALL Surfaces: Bar / Lobby (Cutting Boards, Countertops, Equip, Tables, Chairs)', type: 'passfail' },
        { id: 'op32', text: '2. Place all Sanitized/ Clean Teaspoons + Scoops: in Assigned Area (Powders, Dip-Tub, Proteins, Butters + Creams)', type: 'passfail' },
        { id: 'op33', text: '7. Check Closer’s Progress: Refill Dip Tub, Powders, Toppings, Coco Cubes, Date Paste, Butters, Produce', type: 'passfail' },
        { id: 'op34', text: '3. Power ON: Equip, Lights, TVs, Blenders, Music (street store)) Brew Coffee', type: 'passfail' },
        { id: 'op35', text: '8. Fill up To-Go Disposables (Cups, Bowls, Lids, Straws, Napkins, Cup Carriers, Utensils, Bags)', type: 'passfail' },
        { id: 'op36', text: '4. Rinse then Fill Up 3 Comp Sink: Follow store SOP.', type: 'passfail' },
        { id: 'op37', text: '9. Sanitize and Fill: Ice Bin and shot bucket.', type: 'passfail' },
        { id: 'op38', text: '5. Setup Sanitizer Buckets with clean towels (BOH, FOH, and BAR designated to prevent cross-contamination).', type: 'passfail' },
        { id: 'op39', text: '10. In-Stock or OOS at the POS: In-Store, App, 3rd Party Menus. Log into Toast and Let’s Serve Guests!', type: 'passfail' },
      ]},
      { id: 'temperature-log-equipment-te', title: 'Temperature Log (Equipment/Temp + Location/pH)', requirePhoto: false, items: [
        { id: 'op40', text: 'RTD Fridge(s)', type: 'text' },
        { id: 'op41', text: 'Bar Fridge(s)', type: 'text' },
        { id: 'op42', text: 'Dip Tub(s)', type: 'text' },
        { id: 'op43', text: 'Bar Freezer(s)', type: 'text' },
        { id: 'op44', text: 'BOH Fridge(s)', type: 'text' },
        { id: 'op45', text: 'BOH Freezer(s)', type: 'text' },
        { id: 'op46', text: 'Misc Unit(s)', type: 'text' },
        { id: 'op47', text: '3 Comp Sink', type: 'text' },
        { id: 'op48', text: 'Lobby Bucket', type: 'text' },
        { id: 'op49', text: 'Bar Bucket', type: 'text' },
        { id: 'op50', text: 'BOH Bucket', type: 'text' },
      ]},
      { id: 'deep-cleaning-task-1-rotates', title: 'Deep Cleaning Task #1 (rotates daily across a 7-day cycle; one variant per day, in document order Day 1-7)', requirePhoto: false, items: [
        { id: 'op51', text: 'Floor Drains: Remove drain covering,wipe covering + inside of drain. DO NOT use brushes or sinks used for food prep.', type: 'passfail', allowNA: true },
        { id: 'op52', text: 'All Sinks: (including hand sink): Clean and use Stainless Steel Scrubbers. Clean handles, nuzzles, faucets.', type: 'passfail', allowNA: true },
        { id: 'op53', text: 'High Touch Area: Wipe down utensils/ napkin holders, counter Tops, POS, KDS, Doors, and Glass', type: 'passfail', allowNA: true },
        { id: 'op54', text: 'Retail Display Shelving + TVs: Remove product. Wipe and clear of any dust.', type: 'passfail', allowNA: true },
        { id: 'op55', text: 'Mop Sink + Bucket: Scrub sink and wipe handles, nozzles, and chemical dispensers.', type: 'passfail', allowNA: true },
        { id: 'op56', text: 'ALL Fridges: Remove product, wipe interior/ exterior, doors. Clean gaskets and wash removable parts in 3 Comp sinks.', type: 'passfail', allowNA: true },
        { id: 'op57', text: 'Prep Sink: Clear sinks and use a stainless steel scrubber to remove debris. Wipe handles + faucet.', type: 'passfail', allowNA: true },
      ]},
      { id: 'deep-cleaning-task-2-rotates', title: 'Deep Cleaning Task #2 (rotates daily across a 7-day cycle; one variant per day, in document order Day 1-7)', requirePhoto: false, items: [
        { id: 'op58', text: 'Floors: Sweep all floors. Use deck brush + floor cleaner to scrub. Pull out equipment (baseboards).', type: 'passfail', allowNA: true },
        { id: 'op59', text: 'Store Specific: (Write In)', type: 'passfail', allowNA: true },
        { id: 'op60', text: 'Blenders: Scrub/ Bleach. Handles, base, gear.', type: 'passfail', allowNA: true },
        { id: 'op61', text: 'Store Specific: (Write In)', type: 'passfail', allowNA: true },
        { id: 'op62', text: 'Store Specific: (Write In)', type: 'passfail', allowNA: true },
        { id: 'op63', text: 'Store Specific: (Write In)', type: 'passfail', allowNA: true },
        { id: 'op64', text: 'Dip-Tub: Unplug, remove + swap cambros, defrost, scrape Ice, drain (select models), vacuum vents, wipe down, FIFO restock.', type: 'passfail', allowNA: true },
      ]},
      { id: 'opening-recap', title: 'Opening Recap', requirePhoto: false, items: [
        { id: 'op65', text: 'Stocked to Rock Preparation + Email with Store Photos:', type: 'text' },
        { id: 'op66', text: 'Ice filled to the brim, 10 shots min, Top-down cleaning- leave the countertops and floor beaming! Pull all retail forward, and leave all product labels facing forward.', type: 'text' },
        { id: 'op67', text: 'Today’s Sales Goal: $', type: 'text' },
        { id: 'op68', text: 'Today’s Sales @ 12 P: $', type: 'text' },
        { id: 'op69', text: '% to Plan:', type: 'text' },
        { id: 'op70', text: 'Check Average: $', type: 'text' },
        { id: 'op71', text: 'App Sign Ups Tracker Tally:', type: 'text' },
        { id: 'op72', text: 'Open Recap:', type: 'text' },
        { id: 'op73', text: 'What is the team focusing on to drive the business forward?', type: 'text' },
      ]},
    ],
  };

  const dailyMid = {
    id: 'daily-mid',
    name: 'Daily Mid-Shift (Redbook)',
    cadence: 'daily',
    window: { startHH: 11, endHH: 16 },
    requiresOnsite: false,
    scored: false,
    sections: [
      { id: 'midday-checklist', title: 'Midday Checklist', requirePhoto: false, items: [
        { id: 'mi1', text: 'G.R.E.A.T. Steps Observed: (Greet, Respect, Educate, App/Add-On, Thank)', type: 'passfail' },
        { id: 'mi2', text: 'Break Check: Ensure Rest + Meal Breaks are taken as scheduled', type: 'passfail' },
        { id: 'mi3', text: 'Bus Runs: Lobby Reset ( Table Wiped Down, Sweep, Retail Dusting, Juices Shakes. Bathroom Check + Clean if applicable)', type: 'passfail' },
        { id: 'mi4', text: 'Sanitizer Reset: Change Sanitizer Every 2 Hours and Reset Timer', type: 'passfail' },
        { id: 'mi5', text: 'Refill: Frozens, Toppings, Powders, and Retail', type: 'passfail' },
        { id: 'mi6', text: 'Trash Out: All trash is taken out from Bar and BOH', type: 'passfail' },
        { id: 'mi7', text: 'Pre-Close Tasks: Clean Bar Area, Surfaces, and Wash Dishes', type: 'passfail' },
        { id: 'mi8', text: '* In downtime,focus on education and Guest higher touches (special notes on all “to-go”).', type: 'text' },
      ]},
      { id: 'midday-food-prep-list', title: 'Midday Food Prep List', requirePhoto: false, items: [
        { id: 'mi9', text: 'Almond Creme: ⅙ cambro', type: 'text' },
        { id: 'mi10', text: 'Peanut Butter: ⅙ cambro', type: 'text' },
        { id: 'mi11', text: 'Date Paste: ⅙ cambro', type: 'text' },
        { id: 'mi12', text: 'Spinach: ⅓ cambro', type: 'text' },
        { id: 'mi13', text: 'Berries: 1/9 cambro', type: 'text' },
        { id: 'mi14', text: 'MTO Liquids prepped', type: 'text' },
        { id: 'mi15', text: 'Coconut Cubes into trays', type: 'text' },
        { id: 'mi16', text: 'Select: toast/ latte stations', type: 'text' },
      ]},
    ],
  };

  const dailyClose = {
    id: 'daily-close',
    name: 'Daily Closing (Redbook)',
    cadence: 'daily',
    window: { startHH: 16, endHH: 2 }, // overnight window — core Sched.isOpen supports startHH>endHH
    requiresOnsite: false,
    scored: false,
    sections: [
      { id: 'closing-tasks', title: 'Closing Tasks', requirePhoto: false, items: [
        { id: 'cl1', text: '1. MTO Restock: Frozens, Powders, Liquids, Retail, Disposables', type: 'passfail' },
        { id: 'cl2', text: '5. Clean/ Sanitize all Surfaces: Counters, POS, KDS, Glass, Dip Tub, Windows Tables, Fridges, Cabinets, etc.', type: 'passfail' },
        { id: 'cl3', text: '2. Dish + Clean: Blenders,Equipment, Smallwares, Containers, (washed and returned to their drying stations.)', type: 'passfail' },
        { id: 'cl4', text: '6. Sweep + Mop: BOH, BAR, and Lobby - scrub high traffic areas, sweep baseboards, and clean window sills.', type: 'passfail' },
        { id: 'cl5', text: '3. Aces in Place: Sanitized Items placed in their assigned drying areas.', type: 'passfail' },
        { id: 'cl6', text: '7. Set Up: Empty and Leave 3 Sanitizer Buckets at the 3 Comp Sink for the Opener.', type: 'passfail' },
        { id: 'cl7', text: '4. Power OFF: Equipment, Lights, TV’s, Music. *(Set Alarm if applicable.', type: 'passfail' },
        { id: 'cl8', text: '8. Trash Out: All trash is taken out from Bar + BOH', type: 'passfail' },
      ]},
      { id: 'closing-log', title: 'Closing Log', requirePhoto: false, items: [
        { id: 'cl9', text: 'Closing Log: Please take a photo of this entire page and a photo of your coolers, bar, and back of house. Send to RM + GM', type: 'text' },
        { id: 'cl10', text: 'Today’s Sales Goal: $', type: 'text' },
        { id: 'cl11', text: 'Actual Sales: $', type: 'text' },
        { id: 'cl12', text: 'Check Avg: $', type: 'text' },
        { id: 'cl13', text: 'Total App Signups:', type: 'text' },
        { id: 'cl14', text: '3 Best Sellers + QTY:', type: 'text' },
        { id: 'cl15', text: 'Closing Recap:', type: 'text' },
        { id: 'cl16', text: 'Closing Notes For Opener:', type: 'text' },
      ]},
      { id: 'closing-reflection-people-ro', title: 'Closing Reflection - PEOPLE (rotates daily across a 7-day cycle; tag+question pair per day, in document order Day 1-7)', requirePhoto: false, items: [
        { id: 'cl17', text: 'PEOPLE (Connection + Energy)', type: 'text', allowNA: true },
        { id: 'cl18', text: 'We bring our Values to life through: G.R.E.A.T. Steps of Service. What was a moment today where You or a fellow TM practiced the art of Master Moodshifting; creating space for a Guest to feel like their cup was filled?', type: 'text', allowNA: true },
        { id: 'cl19', text: 'PEOPLE (Integrity)', type: 'text', allowNA: true },
        { id: 'cl20', text: 'We don’t take shortcuts, we take responsibility. What is one thing you did today that created an awesome Guest experience, one that supported a fellow Team Member, + one that empowered You?', type: 'text', allowNA: true },
        { id: 'cl21', text: 'PEOPLE (Contribution)', type: 'text', allowNA: true },
        { id: 'cl22', text: 'We are good teachers + better students. What is one nutritional learning you had today? What is your favorite boost + why? What is the nutrition + science behind that boost?', type: 'text', allowNA: true },
        { id: 'cl23', text: 'PEOPLE (Excellence)', type: 'text', allowNA: true },
        { id: 'cl24', text: 'The relentless pursuit of Excellence makes us better every day. What is 1 thing You / The Team did today that was above + beyond for a Guest today? What was the Guest’s reaction / response?', type: 'text', allowNA: true },
        { id: 'cl25', text: 'PEOPLE (Connection)', type: 'text', allowNA: true },
        { id: 'cl26', text: 'We bring our authentic self to meet people where they are at. Please share an authentic connection you made with a Guest +/or fellow Team Member today. What made that connection special?', type: 'text', allowNA: true },
        { id: 'cl27', text: 'PEOPLE (Connection)', type: 'text', allowNA: true },
        { id: 'cl28', text: 'We bring our Values to life through: G.R.E.A.T. Steps of Service. What was a moment today where You or a fellow TM practiced the art of Master Moodshifting; creating space for a Guest to feel like their cup was filled?', type: 'text', allowNA: true },
        { id: 'cl29', text: 'PEOPLE (Excellence)', type: 'text', allowNA: true },
        { id: 'cl30', text: 'The relentless pursuit of Excellence makes us better every day. What is 1 thing You / The Team did today that was above + beyond for a Guest today? What was the Guest’s reaction / response?', type: 'text', allowNA: true },
      ]},
      { id: 'closing-reflection-process-r', title: 'Closing Reflection - PROCESS (rotates daily across a 7-day cycle; tag+question pair per day, in document order Day 1-7)', requirePhoto: false, items: [
        { id: 'cl31', text: 'PROCESS (Integrity + Contribution)', type: 'text', allowNA: true },
        { id: 'cl32', text: 'Were MTO recipes followed consistently, timely, and served with excellence? How can you take ownership in ensuring we are best in class in everything we do? What is 1 thing you learned today + 1 thing you shared?', type: 'text', allowNA: true },
        { id: 'cl33', text: 'PROCESS (Excellence)', type: 'text', allowNA: true },
        { id: 'cl34', text: 'We measure, celebrate, + learn from our wins + losses alike. What was something You / The Team did today that was a “win” in the Guest’s eyes? What was a “loss” + what did You / The Team learn from this?', type: 'text', allowNA: true },
        { id: 'cl35', text: 'PROCESS (Connection)', type: 'text', allowNA: true },
        { id: 'cl36', text: 'Our Membership / Loyalty Program provides our Guests with many perks. What is your best Up-Share for this program when connecting with our Guests about this? Do you feel any challenges in Up-Sharing? IF so, what?', type: 'text', allowNA: true },
        { id: 'cl37', text: 'PROCESS (Energy)', type: 'text', allowNA: true },
        { id: 'cl38', text: 'We are passionate about treating every Guest as if they fill our cups. We do this by respecting our Guests’ time. What was today’s average ticket time? How can the Team consistently fine tune Speed of Service?', type: 'text', allowNA: true },
        { id: 'cl39', text: 'PROCESS (Integrity)', type: 'text', allowNA: true },
        { id: 'cl40', text: 'We do the right thing because everyone deserves access to wellness. How can you apply this to MTO items, supplements, or Up-Shares?', type: 'text', allowNA: true },
        { id: 'cl41', text: 'PROCESS (Energy)', type: 'text', allowNA: true },
        { id: 'cl42', text: 'We are passionate about treating every Guest as if they fill our cups. We do this by respecting our Guests’ time. What was today’s average ticket time? How can the Team consistently fine tune Speed of Service?', type: 'text', allowNA: true },
        { id: 'cl43', text: 'PROCESS (Integrity + Contribution)', type: 'text', allowNA: true },
        { id: 'cl44', text: 'Were MTO recipes followed consistently, timely, and served with excellence? How can you take ownership in ensuring we are best in class in everything we do? What is 1 thing you learned today + 1 thing you shared?', type: 'text', allowNA: true },
      ]},
      { id: 'closing-reflection-product-r', title: 'Closing Reflection - PRODUCT (rotates daily across a 7-day cycle; tag+question pair per day, in document order Day 1-7)', requirePhoto: false, items: [
        { id: 'cl45', text: 'PRODUCT (Excellence)', type: 'text', allowNA: true },
        { id: 'cl46', text: 'What products are we OOS / low going into tomorrow? What product was the star of the day? Were there any missed opportunities? Are we ready to show up tomorrow like it’s “Game Day”?', type: 'text', allowNA: true },
        { id: 'cl47', text: 'PRODUCT (Energy)', type: 'text', allowNA: true },
        { id: 'cl48', text: 'What products are we OOS / low going into tomorrow? What Team Member had the best Up-Sharing game today? What was the best Up-Share of the day? (Information + Education counts as shares.)', type: 'text', allowNA: true },
        { id: 'cl49', text: 'PRODUCT (Integrity)', type: 'text', allowNA: true },
        { id: 'cl50', text: 'What products are we OOS / low going into tomorrow? Are there any items nearing expiration? Does all of the Fresh Produce look “fresh” + ready for use in the morning?', type: 'text', allowNA: true },
        { id: 'cl51', text: 'PRODUCT (Contribution)', type: 'text', allowNA: true },
        { id: 'cl52', text: 'What products are we OOS / low going into tomorrow? Were there any product questions today that you were unsure of how to answer? IF so, what was it? (We can help!)', type: 'text', allowNA: true },
        { id: 'cl53', text: 'PRODUCT (Excellence)', type: 'text', allowNA: true },
        { id: 'cl54', text: 'What products are we OOS / low going into tomorrow? What is one of your best selling retail items? What is one of your least selling retail items + why do you think Guests do not connect to it?', type: 'text', allowNA: true },
        { id: 'cl55', text: 'PRODUCT (Contribution)', type: 'text', allowNA: true },
        { id: 'cl56', text: 'What products are we OOS / low going into tomorrow? Were there any product questions today that you were unsure of how to answer? IF so, what was it? (We can help!)', type: 'text', allowNA: true },
        { id: 'cl57', text: 'PRODUCT (Energy)', type: 'text', allowNA: true },
        { id: 'cl58', text: 'What products are we OOS / low going into tomorrow? What Team Member had the best Up-Sharing game today? What was the best Up-Share of the day? (Information + Education counts as shares.)', type: 'text', allowNA: true },
      ]},
    ],
  };

  /* ---- OEA Audit — REAL content from Augie's Operations Excellence Audit (O.E.A.).pdf
     (2026-09-16, Teams; Microsoft Forms export, 255-point source). App scores by percent
     of passed items, not source points; doc states no grade cutoffs so A/B/C thresholds
     kept from prior draft. Forms metadata items auto-captured by the app (store, auditor,
     date) omitted; 'Upload a Picture' items kept as passfail with section requirePhoto. */
  const oeaAudit = {
    id: 'oea-audit',
    name: 'OEA Audit',
    cadence: 'monthly',
    requiresOnsite: false,
    scored: true,
    thresholds: { A: 90, B: 75, C: 60 },
    sections: [
      { id: 'audit-overview', title: 'Audit Overview', requirePhoto: false, items: [
        { id: 'oe1', text: 'Name of Person in Charge and Team Members Present', type: 'people' },
        { id: 'oe2', text: 'Audit Type', type: 'select', options: ['Scheduled', 'Unscheduled'] },
      ]},
      { id: 'entrance', title: 'Entrance', requirePhoto: true, items: [
        { id: 'oe3', text: 'Entrance Doors and Windows are Clean and Obstruction Free', type: 'passfail', allowNA: true },
        { id: 'oe4', text: 'Windows and Door Signage/Decals — Posted and In Excellent Condition', type: 'passfail', allowNA: true },
        { id: 'oe5', text: 'Outdoor Seating — Tables and Chairs are All in Working Condition, Clean and Litter Free', type: 'passfail', allowNA: true },
        { id: 'oe6', text: 'Waste Receptable is Clean and Emptied Frequently', type: 'passfail', allowNA: true },
        { id: 'oe7', text: 'A Frame — Criteria: In Use; Not blocking Guest Walkways; In Working Condition; Current Promotion Displayed; Wiped Frequently; N/A (Not Allowed To Display Per Gym Rules)', type: 'passfail' },
        { id: 'oe8', text: 'Entrance Notes', type: 'text' },
        { id: 'oe9', text: 'Upload a Picture of the Entrance', type: 'passfail' },
      ]},
      { id: 'dining-room', title: 'Dining Room', requirePhoto: true, items: [
        { id: 'oe10', text: 'Clear and Obstruction free entrance — Doors and Entrance are Clean, Smudge Free, Free of Obstructions', type: 'passfail', allowNA: true },
        { id: 'oe11', text: 'Online Order Pickup Area is Easy to Find', type: 'passfail', allowNA: true },
        { id: 'oe12', text: 'All Menu Boards (Digital and Hardcopy) are in Working Condition — Criteria: Brightness Level; Clean (No excess dust or smoothie mix splash); Accurate Pricing; Current Promotions Featured; No Damage to Screens or Boards', type: 'passfail' },
        { id: 'oe13', text: 'Guest Seating is Clean and Litter Free', type: 'passfail', allowNA: true },
        { id: 'oe14', text: 'Waste receptacle is Clean and Emptied Frequently', type: 'passfail', allowNA: true },
        { id: 'oe15', text: 'Floors, Walls, and Baseboards are Clean', type: 'passfail', allowNA: true },
        { id: 'oe16', text: 'All lights are Working and On During Business Hours', type: 'passfail', allowNA: true },
        { id: 'oe17', text: 'Music Selection and Volume are Appropriate', type: 'passfail', allowNA: true },
        { id: 'oe18', text: 'Health Department Score is Visible — Local Health Department Signage is Posted if Needed', type: 'passfail', allowNA: true },
        { id: 'oe19', text: 'Dining Room Area Notes', type: 'text' },
        { id: 'oe20', text: 'Upload a Picture of the Dining Room', type: 'passfail' },
      ]},
      { id: 'merchandising', title: 'Merchandising', requirePhoto: true, items: [
        { id: 'oe21', text: 'All Marketing Signage is Current — Criteria: Counter Signs; Vendor Provided Displays; Current Promotion Signage is Front and Center; Damage Free', type: 'passfail' },
        { id: 'oe22', text: 'All Retail Shelving, Baskets, and Risers are Clean and Dust Free', type: 'passfail' },
        { id: 'oe23', text: 'Retail Shelf is Full and Organized — Criteria: No Gaps; Proper Product Grouping; FIFO (check 5 items); Required SKUs; Labels Facing Forward; All Product Pulled Forward', type: 'passfail' },
        { id: 'oe24', text: 'Fridges are Full and Organized — Criteria: No Gaps; Proper Product Grouping; FIFO (check 5 items); Required SKUs; Labels Facing Forward; All Product Pulled Forward; Juices and Shots Shaken Regularly (Every 30 Mins)', type: 'passfail' },
        { id: 'oe25', text: 'Retail Fridge Maintenance — Criteria: Clean Vents; All Lights Working; No Broken Light Bulbs; Temperature settings accurate (41°F)', type: 'passfail' },
        { id: 'oe26', text: 'Merchandizing Notes', type: 'text' },
        { id: 'oe27', text: 'Upload a Picture of the Retail Fridges and Shelving', type: 'passfail' },
      ]},
      { id: 'boh-storage-area', title: 'BOH + Storage Area', requirePhoto: true, items: [
        { id: 'oe28', text: 'Door and Entrance is Clean and Obstruction Free — No Boxes or Product are Blocking Doors or Walkways', type: 'passfail' },
        { id: 'oe29', text: 'Fridges and Freezers are Clean and Temperatures Follow Food Safety Guidelines — Criteria: FIFO (Check 5 items); All Items are Organized and Labeled; Open Product Labeled With Expiration Dates; Designated Area and Bin for Employee Items; Clean and Free of Debris; Temperature Settings are Accurate (Fridge 41°F or Below/ Freezer 0°F)', type: 'passfail' },
        { id: 'oe30', text: 'Dry Storage — Criteria: Heavier Items on Bottom Shelf; Even Weight Distribution (No Heavy Items Stored At The Top. Ex: Bulk Protein, Almond Cream); Items Labeled and Organized; No Personal Items; FIFO (Check 5 items); Shelving Unit in Working Condition', type: 'passfail' },
        { id: 'oe31', text: 'Ice Machine — Criteria: Operational; Filter Changed Out Every 6 Months; Vents Clean and Free of Debris; Inside Free of Mold; Closed When Not In Use', type: 'passfail' },
        { id: 'oe32', text: 'All Sinks are Clean and In Working Condition — Criteria: Inside of Sinks is Clean (No built up residue); Stainless Steel is Clean and Polished; Operational Faucet or Spray Hose; No Pipes are Leaking; Walls Cleaned and Free of Stains', type: 'passfail' },
        { id: 'oe33', text: 'PH Strips are Available and Used Accordingly', type: 'passfail' },
        { id: 'oe34', text: 'Sanitizer Buckets — Criteria: Red (Sanitizer) Buckets Available; Clean Sanitizer Buckets Set Up For Use (Clean Towel Inside Bucket); Changed Every 2 Hours; Buckets Are Stored Off The Floor', type: 'passfail' },
        { id: 'oe35', text: 'Proper 3-Step Dishwashing is Observed — Rinse, Soap, and Sanitize', type: 'passfail' },
        { id: 'oe36', text: 'Cleaning Chemicals Used are Stored According to Local Health Department Guidelines — Criteria: All Chemicals Labeled; No Unapproved Chemicals; Chemical Storage Area is Labeled', type: 'passfail' },
        { id: 'oe37', text: 'Hand Wash Sink is Operational — Soap and Paper Towels Stocked, Hot Water at 120°F', type: 'passfail', allowNA: true },
        { id: 'oe38', text: 'All Stainless Steel Surfaces are Clean and Sparkling', type: 'passfail' },
        { id: 'oe39', text: 'Floors and Drains are Clean and Free of Debris', type: 'passfail' },
        { id: 'oe40', text: 'Mop Sink Area is Clean and Organized', type: 'passfail', allowNA: true },
        { id: 'oe41', text: 'Mop and Broom are Stored in Wall Holder — If Mop Head Is on Mop Stick, Should Be Hung Upside Down If Not In Use', type: 'passfail', allowNA: true },
        { id: 'oe42', text: 'Mop Bucket is Clean and Free of Mold', type: 'passfail' },
        { id: 'oe43', text: 'Clean and Dirty Mop Heads/ Towels Have a Designated Bin/Hamper', type: 'passfail' },
        { id: 'oe44', text: 'Trash Receptables are Clean and Not Overflowing', type: 'passfail' },
        { id: 'oe45', text: 'BOH Notes', type: 'text' },
        { id: 'oe46', text: 'Upload a Picture of the BOH', type: 'passfail' },
      ]},
      { id: 'team-area-boh', title: 'Team Area BOH', requirePhoto: false, items: [
        { id: 'oe47', text: 'All Required Government and Local County Posters are In Compliance — Posted and Up to Date', type: 'passfail' },
        { id: 'oe48', text: 'First Aid Kit is Stocked and Organized', type: 'passfail' },
        { id: 'oe49', text: 'Food Handler Cards are Available and Up to Date', type: 'passfail' },
        { id: 'oe50', text: 'Training Binder is Accessible', type: 'passfail' },
        { id: 'oe51', text: 'Store Has a Designated and Clean Employee storage Area and Workstation', type: 'passfail', allowNA: true },
        { id: 'oe52', text: 'Story Board is Posted and Actively Being Used — Criteria: Sent Monthly; Board in Excellent Condition; Actively Filled In', type: 'passfail' },
        { id: 'oe53', text: 'Notes', type: 'text' },
      ]},
      { id: 'foh-service-line-bar', title: 'FOH Service Line/Bar', requirePhoto: true, items: [
        { id: 'oe54', text: 'Hand Washing and Glove Usage is Observed', type: 'passfail' },
        { id: 'oe55', text: 'Cup Method is Observed', type: 'passfail' },
        { id: 'oe56', text: 'Team Members are Following all Steps of Line Guides for Accurate MTOs — Build Guides are Up to Date', type: 'passfail' },
        { id: 'oe57', text: 'MTOs Presentation and Taste are According to Specs', type: 'passfail' },
        { id: 'oe58', text: 'The Correct Size of Smallwares Are Being Used — Teaspoons, Tablespoons, and Scoops', type: 'passfail', allowNA: true },
        { id: 'oe59', text: 'All Boosts and Powders are Labeled', type: 'passfail', allowNA: true },
        { id: 'oe60', text: 'Bar Set Up/ Flow is Clear, Clean and Defined', type: 'passfail', allowNA: true },
        { id: 'oe61', text: 'Coffee Machine — Criteria: Operational; Stainless Steel is Clean and Sparkling; Water Filter Changed Every 6 Months; Hot Water Available', type: 'passfail' },
        { id: 'oe62', text: 'Floors and Drains are Clean and Free of Debris', type: 'passfail' },
        { id: 'oe63', text: 'Containers, Fridges, Freezers, Dip Box, and Ice Bin are Covered When Not in Use', type: 'passfail' },
        { id: 'oe64', text: 'All Freezer and Fridge Temperatures Follow Food Safety Guidelines — Fridge at 41°F or below/ Freezer 0°F', type: 'passfail' },
        { id: 'oe65', text: 'All Fridges and Freezers are Clean (Inside and Outside)', type: 'passfail' },
        { id: 'oe66', text: 'All Stainless Steel Surfaces are Clean and Sparkling', type: 'passfail' },
        { id: 'oe67', text: 'Sinks are Clean and Soap and Paper Towels are Available — Hot Water at 120°F', type: 'passfail', allowNA: true },
        { id: 'oe68', text: 'Sanitizer Buckets — Criteria: Red (Sanitizer) Buckets Available; Clean Sanitizer Buckets; Changed Every 2 Hours; Buckets Are Stored Off The Floor', type: 'passfail' },
        { id: 'oe69', text: 'All Open Items are Labeled and Dated', type: 'passfail' },
        { id: 'oe70', text: 'Guest Handoff Section is Stocked with Utensils and Clean', type: 'passfail', allowNA: true },
        { id: 'oe71', text: 'All Sneeze Guards are Clean and Smudge Free', type: 'passfail', allowNA: true },
        { id: 'oe72', text: 'Blender and Blender Bases are Clean and Operational — Sockets are Changed When Needed', type: 'passfail' },
        { id: 'oe73', text: 'Blue Blenders for Allergens are Available — Labeled and Kept Separate to Minimize Cross Contamination', type: 'passfail' },
        { id: 'oe74', text: 'Notes', type: 'text' },
        { id: 'oe75', text: 'Upload a Picture of the Service Line/Bar', type: 'passfail' },
      ]},
      { id: 'product-quality-assurance', title: 'Product Quality Assurance', requirePhoto: true, items: [
        { id: 'oe76', text: 'Enter the Name of the MTO Made for This Audit', type: 'text' },
        { id: 'oe77', text: 'What Was the Total Turn Time of the Order? — Check KDS for Turn Time', type: 'text' },
        { id: 'oe78', text: 'Describe the Presentation of the MTO. Was It Up to Standard Set for That MTO? (Thick, Runny, Chunky, etc.)', type: 'text' },
        { id: 'oe79', text: 'Did the Taste Match the Intended Flavor Profile for This Specific MTO Item? How Would You Describe the Flavor?', type: 'text' },
        { id: 'oe80', text: 'Please Rate the MTO (10-star rating scale)', type: 'rating' },
        { id: 'oe81', text: 'Upload a Picture of MTO for Product Quality Assurance Test', type: 'passfail' },
      ]},
      { id: 'redbook', title: 'Redbook', requirePhoto: false, items: [
        { id: 'oe82', text: 'Redbook is Available and In Good Condition', type: 'passfail' },
        { id: 'oe83', text: 'GM and Team Members are Actively Using the Redbook — Please Check for the Following: PH & Temp Log; Waste & Sample Log; SOPs; Time Off Calendar', type: 'passfail' },
        { id: 'oe84', text: 'Stock to Rock Section is Filled and Sent According to Standards', type: 'passfail' },
        { id: 'oe85', text: 'Closing Report Section Filled and Sent According to Standards', type: 'passfail' },
        { id: 'oe86', text: 'All Current SOPs are Available', type: 'passfail' },
        { id: 'oe87', text: 'FOH/Redbook Notes', type: 'text' },
      ]},
      { id: 'pos', title: 'POS', requirePhoto: false, items: [
        { id: 'oe88', text: 'POS Counter is Clean and Organized', type: 'passfail', allowNA: true },
        { id: 'oe89', text: 'Current Promotions are Featured at the POS Area', type: 'passfail', allowNA: true },
        { id: 'oe90', text: 'POS Screens are Clean and Smudge Free', type: 'passfail' },
        { id: 'oe91', text: 'Guest Facing POS Screen is Showing Accurate and Current Promotions', type: 'passfail' },
        { id: 'oe92', text: 'Items are Correctly Marked In/Out of Stock on POS and 3rd Party Tablets', type: 'passfail' },
        { id: 'oe93', text: '3rd Party Tablets are Live and Accepting Orders', type: 'passfail', allowNA: true },
        { id: 'oe94', text: 'Bowl of Shots is Full and Displayed Accordingly', type: 'passfail', allowNA: true },
        { id: 'oe95', text: 'All Cables are Organized and Out of Guest View if Possible', type: 'passfail' },
        { id: 'oe96', text: 'Store Phone, Printer, and Laptop/Tablet are on Site and Operational', type: 'passfail', allowNA: true },
        { id: 'oe97', text: 'Sampling Infographics are Available', type: 'passfail' },
        { id: 'oe98', text: 'Rewards Cards and Discount Flyers are Available and Actively Used', type: 'passfail', allowNA: true },
        { id: 'oe99', text: 'Personal Employee Items are Kept off POS Area — Earphones, Phones, Drinks, Food, Etc.', type: 'passfail' },
        { id: 'oe100', text: 'Notes', type: 'text' },
        { id: 'oe101', text: 'Upload Picture of the POS Counter', type: 'text' },
      ]},
      { id: 'restroom', title: 'Restroom', requirePhoto: false, items: [
        { id: 'oe102', text: 'Doors and Handles are Clean', type: 'passfail', allowNA: true },
        { id: 'oe103', text: 'Sink, Toilet, and Lights are All Clean and In Working Condition', type: 'passfail', allowNA: true },
        { id: 'oe104', text: 'Paper and Sanitary Products are Stocked', type: 'passfail', allowNA: true },
        { id: 'oe105', text: 'Mirror is Clean and Smudge Free', type: 'passfail', allowNA: true },
      ]},
      { id: 'team-performance', title: 'Team Performance', requirePhoto: false, items: [
        { id: 'oe106', text: 'All Team Members are In Pre-Approved Work Attire', type: 'passfail', allowNA: true },
        { id: 'oe107', text: 'Personal Device Usage is Observed (Air pods, Phones, Etc.) — Exception if Team Member is Using Device to Send Reports', type: 'passfail' },
        { id: 'oe108', text: 'Team Members are Productive When Not Actively Assisting Guests — Restocking, Cleaning, Organizing, or Preparing Samples', type: 'passfail' },
        { id: 'oe109', text: 'Team Members are Actively Promoting Our Rewards Program — Criteria: Can List the App Benefits; Can Guide Guests Through Signing Up; Can Guide Guests Through Placing an Order Through the App; Can Guide Guests Through Redeeming Rewards', type: 'passfail' },
        { id: 'oe110', text: 'Team Members are Following all SOP Procedures to Ensure a Positive Yet Consistent Experience Company-Wide', type: 'passfail' },
        { id: 'oe111', text: 'All Team Members up to date on current promotions — Criteria: Promotion Timeline; Knowledge On Promotional Item; Upsharing of Promotional Item', type: 'passfail' },
        { id: 'oe112', text: 'GREAT Steps of Service are observed', type: 'passfail' },
      ]},
      { id: 'mod-pic-performance', title: 'MOD/PIC Performance', requirePhoto: false, items: [
        { id: 'oe113', text: 'Actively Tracking Their Store\'s Current Sales, Labor, and COGs vs Their Goals.', type: 'passfail', allowNA: true },
        { id: 'oe114', text: 'Schedules Are Posted According to Local Government Laws', type: 'passfail', allowNA: true },
        { id: 'oe115', text: 'Consistently Embodies Our Company Values and Sets the Standard for the Team', type: 'passfail' },
        { id: 'oe116', text: 'Provides Consistent Coaching and Feedback to Their Team Members', type: 'passfail' },
        { id: 'oe117', text: 'Promotes a Positive, Guest Focused, and Respectful Team Environment', type: 'passfail' },
        { id: 'oe118', text: 'Consistently Uses the Tools Provided by the Support Center — Training Binder, Redbook, Marketing Support Request Form, IT Support Request Form, and Team Portal', type: 'passfail' },
        { id: 'oe119', text: 'Actively Supports Both Individual and Team Growth, With a Strong Focus on Developing Team Members.', type: 'passfail' },
        { id: 'oe120', text: 'Communicates Current Goals, Promotions and Expectations to Entire Team', type: 'passfail' },
      ]},
    ],
  };

  /* ---- Health Code Self-Audit — drafted from standard food-safety practice. */
  const healthCode = {
    id: 'health-code',
    name: 'Health Code Self-Audit',
    cadence: 'quarterly',
    requiresOnsite: false,
    scored: true,
    thresholds: { A: 90, B: 75, C: 60 },
    sections: [
      { id: 'hc-temp', title: 'Temperature Control', requirePhoto: false, items: [
        { id: 'ht1', text: 'Cold holding units at or below 41°F', type: 'passfail', critical: true },
        { id: 'ht2', text: 'Hot holding units at or above 135°F', type: 'passfail', critical: true },
        { id: 'ht3', text: 'Walk-in cooler temp (°F)', type: 'text' },
        { id: 'ht4', text: 'Temperature logs current for the past 7 days', type: 'passfail' },
        { id: 'ht5', text: 'Thermometers calibrated and available at each station', type: 'passfail' },
      ]},
      { id: 'hc-hygiene', title: 'Hygiene & Handwashing', requirePhoto: false, items: [
        { id: 'hh1', text: 'Handwashing sinks stocked (soap, paper towels, hot water)', type: 'passfail', critical: true },
        { id: 'hh2', text: 'Team observed washing hands at required intervals', type: 'passfail' },
        { id: 'hh3', text: 'Gloves used correctly for ready-to-eat food', type: 'passfail', critical: true },
        { id: 'hh4', text: 'No jewelry/watches worn on hands during prep', type: 'passfail' },
        { id: 'hh5', text: 'Food handler certifications current and on file', type: 'passfail' },
      ]},
      { id: 'hc-crosscontam', title: 'Cross-Contamination & Storage', requirePhoto: true, items: [
        { id: 'hx1', text: 'Raw and ready-to-eat items stored/labeled separately', type: 'passfail', critical: true },
        { id: 'hx2', text: 'All stored product labeled with prep/discard date', type: 'passfail' },
        { id: 'hx3', text: 'FIFO rotation observed in walk-in and dry storage', type: 'passfail' },
        { id: 'hx4', text: 'Cutting boards/utensils color-coded and in good condition', type: 'passfail' },
        { id: 'hx5', text: 'Chemicals stored away from food product', type: 'passfail', critical: true },
      ]},
      { id: 'hc-pest', title: 'Pest & Facility', requirePhoto: true, items: [
        { id: 'hp1', text: 'No evidence of pest activity', type: 'passfail', critical: true },
        { id: 'hp2', text: 'Doors/windows sealed, no gaps to exterior', type: 'passfail' },
        { id: 'hp3', text: 'Drains clear and free of buildup', type: 'passfail' },
        { id: 'hp4', text: 'Most recent health inspection posted and score acceptable', type: 'passfail' },
        { id: 'hp5', text: 'Pest control service log current', type: 'passfail' },
      ]},
    ],
  };

  /* ---- DM Travel Path — REAL content from Augie's TEMPLATE Store Visit Travel Path +
     Weekly Focus (1).pptx (2026-09-16, Teams). Core path = Pre/During/Post visit; Weekly
     Focus rotates Team/Guest/Financial/Store (deck states no rotation rule; ISO-week
     rotation kept). '*Weekly Focus' placeholder rows dropped — rotating sections cover it. */
  const travelPath = {
    id: 'travel-path',
    name: 'DM Travel Path / Stock-to-Rock',
    cadence: 'daily',
    requiresOnsite: false,
    scored: false,
    rotatingThemes: ['Team', 'Guest', 'Financial', 'Store'],
    sections: [
      { id: 'pre-visit', title: 'Pre-Visit', requirePhoto: false, items: [
        { id: 'tp1', text: 'Respond to emails', type: 'passfail' },
        { id: 'tp2', text: '3 Stock to Rock', type: 'passfail' },
        { id: 'tp3', text: '3 Closing Logs', type: 'passfail' },
        { id: 'tp4', text: 'Timecard audit in UKG', type: 'passfail' },
        { id: 'tp5', text: 'Review previous day data', type: 'text' },
        { id: 'tp6', text: 'Sales in Toast', type: 'passfail' },
        { id: 'tp7', text: 'Adherence in UKG', type: 'passfail' },
        { id: 'tp8', text: 'Out of Stocks in app', type: 'passfail' },
      ]},
      { id: 'every-store-visit', title: 'Every Store Visit', requirePhoto: false, items: [
        { id: 'tp9', text: 'Connection', type: 'text' },
        { id: 'tp10', text: 'Connect with one individual + learn something new about them', type: 'passfail' },
        { id: 'tp11', text: 'Talk Thoughtful Tuesday/Thursday Pulse/CEO Message', type: 'passfail' },
        { id: 'tp12', text: 'Review previous week\'s visit needs', type: 'passfail' },
        { id: 'tp13', text: '6 Ops Pillars Lense + Store Walkthrough', type: 'text' },
        { id: 'tp14', text: 'Curbside → Lobby → POS → BAR → Handoff → BOH/COMM BOARD → RETAIL PLANO', type: 'text' },
        { id: 'tp15', text: 'Operations Check', type: 'text' },
        { id: 'tp16', text: 'Redbook compliance', type: 'passfail' },
        { id: 'tp17', text: 'Integrity/review with GM/TM', type: 'passfail' },
        { id: 'tp18', text: 'Feedback', type: 'text' },
        { id: 'tp19', text: 'Provide learnings/wins and opportunities with TM/GM.', type: 'passfail' },
        { id: 'tp20', text: 'Review previous visit changes', type: 'passfail' },
        { id: 'tp21', text: 'Say goodbye to every TM and thank them for their time.', type: 'passfail' },
      ]},
      { id: 'post-visit', title: 'Post-Visit', requirePhoto: false, items: [
        { id: 'tp22', text: 'Respond to emails', type: 'passfail' },
        { id: 'tp23', text: '3 Stock to Rock', type: 'passfail' },
        { id: 'tp24', text: '3 Closing Logs', type: 'passfail' },
        { id: 'tp25', text: 'Recap Store Visit', type: 'text' },
        { id: 'tp26', text: 'Send email to GM with 3 development opportunities from visit with measures and due dates', type: 'passfail' },
      ]},
      { id: 'focus-team', title: 'Weekly Focus — Team', requirePhoto: false, theme: 'Team', items: [
        { id: 'tp27', text: 'Review "T" Score on KPI Scorecard for last month + gameplan', type: 'passfail' },
        { id: 'tp28', text: 'Calling Card: Review with GM/TM. How have you in the last month leaned into your calling.', type: 'text' },
        { id: 'tp29', text: 'IDP: Progress on competency development since the last month – progress check.', type: 'text' },
        { id: 'tp30', text: 'Multiversity: Training Scorecard review (progress towards next campaign)', type: 'text' },
        { id: 'tp31', text: 'Successions planning', type: 'text' },
        { id: 'tp32', text: 'Scheduling accuracy', type: 'text' },
        { id: 'tp33', text: 'TM attestation questions', type: 'text' },
        { id: 'tp34', text: 'Team meetings / team huddles', type: 'text' },
        { id: 'tp35', text: 'Team samplings (new products)', type: 'text' },
        { id: 'tp36', text: 'Turnover/retention', type: 'text' },
        { id: 'tp37', text: 'Moral/energy', type: 'text' },
      ]},
      { id: 'focus-guest', title: 'Weekly Focus — Guest', requirePhoto: false, theme: 'Guest', items: [
        { id: 'tp38', text: 'Review "G" Score on KPI Scorecard for last month + gameplan', type: 'passfail' },
        { id: 'tp39', text: 'GREAT Guest Service Audits: Filter through the lens of 6 Ops Pillars', type: 'text' },
        { id: 'tp40', text: 'Review Marketing Scorecard: Service metrics, capture rate, check-in trends', type: 'text' },
        { id: 'tp41', text: 'Campaign Review: Prepare for upcoming campaign or review the past one.', type: 'text' },
        { id: 'tp42', text: 'Up-sharing', type: 'text' },
        { id: 'tp43', text: 'Build guide compliance', type: 'text' },
        { id: 'tp44', text: 'Bar flow matches build guides', type: 'text' },
        { id: 'tp45', text: 'Audit synergistic partnership exists with gym partner', type: 'text' },
      ]},
      { id: 'focus-financial', title: 'Weekly Focus — Financial', requirePhoto: false, theme: 'Financial', items: [
        { id: 'tp46', text: 'Review "F" Score on KPI Scorecard for last month + gameplan', type: 'passfail' },
        { id: 'tp47', text: 'P&L Recaps: Due from every GM and DM for earlier period', type: 'text' },
        { id: 'tp48', text: 'Repair and Maintenance: Ensure tickets are submitted for anything broken, missing, needing service', type: 'text' },
        { id: 'tp49', text: 'Labor', type: 'text' },
        { id: 'tp50', text: 'COGS', type: 'text' },
        { id: 'tp51', text: 'EBITDA', type: 'text' },
        { id: 'tp52', text: 'Scheduling for next 3 weeks', type: 'text' },
        { id: 'tp53', text: 'Hours of operation adjustments based on check-ins', type: 'text' },
      ]},
      { id: 'focus-store', title: 'Weekly Focus — Store', requirePhoto: false, theme: 'Store', items: [
        { id: 'tp54', text: 'Review "S" Score on KPI Scorecard for last month + gameplan', type: 'passfail' },
        { id: 'tp55', text: 'OEA Mock / Prep Audit: Due from every GM and DM', type: 'text' },
        { id: 'tp56', text: 'Store Signoff Digitized Checklist: Food Handlers, POP, plannograms, invoices reconciled, etc.', type: 'text' },
        { id: 'tp57', text: 'Deep cleaning schedule review', type: 'text' },
        { id: 'tp58', text: 'Ordering and receiving', type: 'text' },
        { id: 'tp59', text: 'Store organization', type: 'text' },
      ]},
    ],
  };

  /* Exposed as a plain top-level const (shares the global lexical scope classic
     <script> tags run in, same pattern core.js relies on for UI/Sched/Data/App) so
     admin.js can diff a live template against its shipped default to show the
     custom/modified/default badge — without core.js exposing db internals. */
  const TEMPLATE_DEFAULTS = [storeVisit, dailyOpen, dailyMid, dailyClose, oeaAudit, healthCode, travelPath];

  Data.registerTemplates(TEMPLATE_DEFAULTS);
