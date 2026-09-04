/* ═══════════════════════════════════════════════════════════════
   STUDYRIA BRAINLAB EXTENSION — V6.0 Additive Layer
   Safe additive changes ONLY. Does NOT modify brainlab.js.
   Enhances: Daily Challenge UI, Current Affairs 2026, Mistake Book 2.0
   ═══════════════════════════════════════════════════════════════ */

/* ── 2026 Current Affairs Dataset (verified from public sources) ── */
var CA_2026 = [
  {title:'Assam Earthquake — Magnitude 5.1',date:'2026-01-15',month:'January',category:'Assam',importance:'high',
   summary:'A magnitude 5.1 earthquake struck Assam, causing damage to buildings and infrastructure in several districts.',
   facts:['Magnitude: 5.1 on Richter scale','Epicenter: Near Tezpur, Assam','Felt across Northeast India','No major casualties reported'],
   tags:['assam','earthquake','disaster','northeast'],source:'Wikipedia / IMD'},
  {title:'India 77th Republic Day Celebrations',date:'2026-01-26',month:'January',category:'India',importance:'high',
   summary:'India celebrated its 77th Republic Day on January 26, 2026, with the main parade on Kartavya Path, New Delhi.',
   facts:['77th Republic Day of India','Main parade on Kartavya Path','Padma Awards announced on eve of Republic Day','131 Padma Awards conferred for 2026'],
   tags:['republic-day','national','india','padma-awards'],source:'PIB / Government of India'},
  {title:'Padma Awards 2026 Announced',date:'2026-01-25',month:'January',category:'Awards',importance:'high',
   summary:'President approved 131 Padma Awards for 2026: 5 Padma Vibhushan, 13 Padma Bhushan, 113 Padma Shri.',
   facts:['Total: 131 awards','5 Padma Vibhushan, 13 Padma Bhushan, 113 Padma Shri','19 women awardees','6 Foreigners/NRI/PIO/OCI','16 posthumous awardees','Key recipients: Dharmendra (Padma Vibhushan, posthumous), KT Thomas, Mammootty (Padma Bhushan), Vijay Amritraj (Padma Bhushan), Rohit Sharma (Padma Shri), Harmanpreet Kaur (Padma Shri)','Assam awardees: Haricharan Saikia, Jogesh Deuri, Kabindra Purkayastha (posthumous), Nuruddin Ahmed, Pokhila Lekthepi'],
   tags:['padma-awards','civilians-awards','india','honours'],source:'PIB Ministry of Home Affairs'},
  {title:'Union Budget 2026-27 Presented',date:'2026-02-01',month:'February',category:'Economy',importance:'high',
   summary:'Finance Minister Nirmala Sitharaman presented the Union Budget for FY 2026-27 in Parliament on February 1, 2026.',
   facts:['Presented by FM Nirmala Sitharaman','Date: February 1, 2026','New schemes: Electronics Components Manufacturing Scheme, Rare Earth Permanent Magnets Scheme','India GDP growth projected at 7.4% for FY26','GDP growth estimated 6.8-7.2% for FY27','Record capital expenditure allocation'],
   tags:['union-budget','economy','fiscal','government-schemes'],source:'indiabudget.gov.in / PIB'},
  {title:'Electronics Components Manufacturing Scheme Launched',date:'2026-02-01',month:'February',category:'Government Schemes',importance:'medium',
   summary:'New scheme announced in Union Budget 2026-27 to boost domestic electronics component manufacturing.',
   facts:['Announced in Union Budget 2026-27','Aims to reduce electronics imports','Part of Make in India initiative','Focus on semiconductor and electronic components'],
   tags:['manufacturing','electronics','make-in-india','budget'],source:'Union Budget 2026-27'},
  {title:'Rare Earth Permanent Magnets Scheme',date:'2026-02-01',month:'February',category:'Government Schemes',importance:'medium',
   summary:'Scheme for Rare Earth Permanent Magnets launched to reduce import dependency and boost domestic production.',
   facts:['Announced in Union Budget 2026-27','Aims to develop domestic rare earth magnet supply chain','Critical for EV and electronics industries','Reduces dependence on China for rare earth materials'],
   tags:['rare-earth','manufacturing','strategic','budget'],source:'Union Budget 2026-27'},
  {title:'BRICS Academic Forum 2026 Convened',date:'2026-03-17',month:'March',category:'International Relations',importance:'medium',
   summary:'ORF in partnership with RIS hosted the Inaugural Convening of the BRICS Academic Forum in April 2026.',
   facts:['Hosted by ORF and RIS','Part of India BRICS Presidency 2026','Dates: April 17-18, 2026','Venue: New Delhi','Academic dialogue among BRICS nations'],
   tags:['brics','academic-forum','india','international'],source:'orfonline.org'},
  {title:'2026 Assam Legislative Assembly Election',date:'2026-04-09',month:'April',category:'Assam',importance:'high',
   summary:'Assam Legislative Assembly elections held on April 9, 2026 to elect 126 members. BJP won a landslide with 82 seats.',
   facts:['Date: April 9, 2026','Total seats: 126','BJP won 82 seats (landslide victory)','INC won 19 seats','BJP-led NDA secured 102 out of 126 seats','Third consecutive term for BJP-led NDA in Assam','Voter qualifying date: January 1, 2026','Fully women-managed polling stations established'],
   tags:['assam','election','assembly','bjp','politics','democracy'],source:'ECI / Wikipedia'},
  {title:'Assam Election — BJP Landslide Victory',date:'2026-04-11',month:'April',category:'Assam',importance:'high',
   summary:'BJP achieved a landslide victory in the 2026 Assam Assembly Election, winning 82 seats out of 126.',
   facts:['BJP: 82 seats (37.81% vote share)','INC: 19 seats (29.84% vote share)','NDA total: 102 seats','Third consecutive term for BJP in Assam','Result declared in May 2026','CM Himanta Biswa Sarma led the campaign'],
   tags:['assam','election-results','bjp','politics'],source:'ECI results.eci.gov.in'},
  {title:'Assam Election Results Declared',date:'2026-05-02',month:'May',category:'Assam',importance:'high',
   summary:'Election Commission declared results for the 2026 Assam Assembly Election. BJP won with absolute majority.',
   facts:['Results declared first week of May 2026','BJP: 82 seats','INC: 19 seats','AGP and other allies contributed to NDA total of 102','BJP formed government for third consecutive term'],
   tags:['assam','election','results','government-formation'],source:'ECI / Frontline'},
  {title:'India Surpasses US in Solar Capacity Addition',date:'2026-06-15',month:'June',category:'Environment',importance:'medium',
   summary:'India surpassed the United States by adding 37 GW of solar capacity in 2025, becoming a global solar leader.',
   facts:['India added 37 GW solar capacity in 2025','Surpassed the United States','India became one of top solar installers globally','Part of India renewable energy targets','India aims for 500 GW non-fossil capacity by 2030'],
   tags:['solar','renewable-energy','environment','india'],source:'pmfias.com / MNRE'},
  {title:'Assam Floods 2026',date:'2026-07-19',month:'July',category:'Assam',importance:'high',
   summary:'Severe floods hit Assam in July 2026, affecting multiple districts along the Brahmaputra river.',
   facts:['Date: July 19, 2026 onwards','Multiple districts affected','Brahmaputra river above danger level','Kaziranga National Park partially submerged','Thousands displaced','Army and NDRF rescue operations launched'],
   tags:['assam','floods','disaster','brahmaputra','kaziranga'],source:'Wikipedia / NDMA'},
  {title:'Glaw Lake — India 101st Ramsar Site',date:'2026-07-20',month:'July',category:'Environment',importance:'medium',
   summary:'Glaw Lake was officially designated as India 101st Ramsar Site, a significant milestone for wetland conservation.',
   facts:['Glaw Lake: India 101st Ramsar Site','Designated in 2026','India has the most Ramsar sites in South Asia','Ramsar Convention: International wetland conservation treaty','India Ramsar count growing rapidly'],
   tags:['ramsar','wetland','environment','conservation','india'],source:'Vision IAS / MoEFCC'},
  {title:'Vande Mataram Protection Bill Gets Presidential Assent',date:'2026-08-10',month:'August',category:'Polity',importance:'high',
   summary:'President Droupadi Murmu gave assent to a Bill criminalising insult to the national song Vande Mataram, granting it the same legal protection as the national anthem.',
   facts:['President: Droupadi Murmu','Bill: Prevention of Insults to National Honour (Amendment) Bill, 2026','Amends Section 3 of the Prevention of Insults to National Honour Act, 1971','Vande Mataram now has same legal protection as Jana Gana Mana','Criminalises intentional disruption or prevention of singing Vande Mataram'],
   tags:['vande-mataram','national-song','polity','parliament','law'],source:'AffairsCloud / PIB'},
  {title:'IBM, MIT-Bengaluru and Christ University Establish AI Centres',date:'2026-08-12',month:'August',category:'Science & Technology',importance:'medium',
   summary:'IBM partnered with MIT Bengaluru and Christ University to establish AI-focused centres in India for research and skilling.',
   facts:['IBM partnered with MIT Bengaluru (MAHE) and Christ University','IBM-MIT AI Lab at Bengaluru campus','HPC infrastructure and GPU-based resources','Research: ML, Deep Learning, Generative AI, Cybersecurity, Healthcare','IBM Innovation Center for AI at Christ University','Technologies: watsonx.ai, IBM Bob','Focus: Agentic AI, LLMs, RAG, responsible AI'],
   tags:['ibm','ai','technology','education','research','india'],source:'AffairsCloud'},
  {title:'India First Black-Necked Crane Festival',date:'2026-08-12',month:'August',category:'Assam',importance:'medium',
   summary:'India celebrated its first Black-Necked Crane Festival, highlighting conservation of this endangered species.',
   facts:['First Black-Necked Crane Festival in India','Date: August 12, 2026','Black-necked crane: endangered species','Found in high-altitude wetlands of Ladakh and Northeast India','Festival promotes awareness and conservation'],
   tags:['black-necked-crane','festival','wildlife','conservation','assam'],source:'YouTube Current Affairs / DD News'},
  {title:'Assam Tourism Records Strong Growth in 2026',date:'2026-08-13',month:'August',category:'Assam',importance:'medium',
   summary:'Assam tourism witnessed a robust upward trend with over 85 lakh tourists including approximately 47,000 foreign tourists.',
   facts:['Over 85 lakh tourists visited Assam','Approximately 47,000 foreign tourists','Robust upward trend in tourism','Key attractions: Kaziranga, Kamakhya, Majuli','Tourism contributes significantly to Assam economy'],
   tags:['tourism','assam','economy','kaziranga','majuli'],source:'Instagram / Assam Tourism'},
  {title:'SBI Research Projects 8% GDP Growth for Q1 FY27',date:'2026-08-13',month:'August',category:'Economy',importance:'high',
   summary:'SBI Research projected India GDP growth to rebound to around 8% in Q1 FY27, higher than RBI projection of 7%.',
   facts:['SBI Research Ecowrap report','GDP growth projected: ~8% for Q1 FY27','RBI projection was 7%','86% of economic indicators showed acceleration','Key drivers: consumer demand, vehicle sales (+24.1%), consumer credit (+15.8%)','IIP growth: 7.3% in June 2026','Service PMI: 57.3 in June 2026'],
   tags:['gdp','economy','sbi','growth','india'],source:'AffairsCloud / SBI Research'},
  {title:'Orunodoi Scheme 3.0 Restarted in Assam',date:'2026-08-01',month:'August',category:'Government Schemes',importance:'high',
   summary:'Assam Government restarted the Orunodoi Scheme from August 1, 2026. 37.1 lakh women to receive Rs.1,250 per month through DBT.',
   facts:['Restarted: August 1, 2026','Beneficiaries: 37.1 lakh women','Monthly assistance: Rs.1,250','Direct Benefit Transfer (DBT)','AADHAAR seeding for efficient disbursal','Orunodoi 3.0: expanded version with automatic AADHAAR seeding'],
   tags:['orunodoi','assam','welfare-scheme','dbt','women','government-schemes'],source:'Assam Government / myscheme.gov.in'},
  {title:'India Hosts BRICS Summit 2026',date:'2026-09-12',month:'September',category:'International Relations',importance:'high',
   summary:'India is hosting the 18th BRICS Summit in New Delhi on September 12-13, 2026 as part of its BRICS Presidency 2026.',
   facts:['India is BRICS Chair for 2026','18th BRICS Summit: September 12-13, 2026','Venue: New Delhi','Focus: economic, financial, technological, environmental cooperation','Multiple ministerial meetings throughout 2026','Theme: Building for Resilience, Innovation, Cooperation'],
   tags:['brics','india','summit','international','diplomacy'],source:'brics2026.gov.in'},
  {title:'Asian Games 2026 — Aichi-Nagoya, Japan',date:'2026-09-19',month:'September',category:'Sports',importance:'high',
   summary:'20th Asian Games 2026 scheduled in Aichi-Nagoya, Japan. India sent approximately 700 athletes across 19 sports.',
   facts:['20th Asian Games 2026','Host: Aichi-Nagoya, Japan','India: ~700 athletes (400 men, 300 women)','19 sports for India','Previous Asian Games (2022 Hangzhou): India won 107 medals (28 gold, 38 silver, 41 bronze)','India best Asiad performance was 107 medals in 2022','Men hockey team participating'],
   tags:['asian-games','sports','india','japan','hockey'],source:'olympics.com / Wikipedia'},
  {title:'India Tourism Growth and Infrastructure Push',date:'2026-06-01',month:'June',category:'Economy',importance:'low',
   summary:'India continued its infrastructure and tourism push through various initiatives in 2026, with focus on Northeast development.',
   facts:['Infrastructure spending at record levels in Budget 2026-27','Northeast development projects prioritized','Tourism circuits in Assam and Northeast expanded','Railway connectivity improvements in Northeast'],
   tags:['tourism','infrastructure','economy','northeast'],source:'Union Budget 2026-27'}
];

/* ── Current Affairs Quiz Question Bank (from verified data) ── */
var CA_QUIZ = [
  {q:'In the 2026 Assam Legislative Assembly election, how many seats did BJP win?',o:['82','65','92','75'],a:0,cat:'Assam',exp:'BJP won 82 seats out of 126 in the 2026 Assam Assembly Election, achieving a landslide victory.',tags:['assam','election','bjp'],imp:true},
  {q:'The 2026 Assam Legislative Assembly election was held on which date?',o:['April 9, 2026','March 15, 2026','May 1, 2026','April 26, 2026'],a:0,cat:'Assam',exp:'The Assam Assembly election was held on April 9, 2026 to elect 126 members.',tags:['assam','election'],imp:true},
  {q:'How many total seats are there in the Assam Legislative Assembly?',o:['126','120','100','140'],a:0,cat:'Assam',exp:'The Assam Legislative Assembly has 126 seats.',tags:['assam','polity'],imp:false},
  {q:'The BJP-led NDA secured how many seats in the 2026 Assam election?',o:['102','85','95','110'],a:0,cat:'Assam',exp:'The BJP-led NDA secured 102 out of 126 seats in the 2026 Assam Assembly Election.',tags:['assam','election','nda'],imp:true},
  {q:'How many Padma Awards were conferred in 2026?',o:['131','120','139','145'],a:0,cat:'Awards',exp:'131 Padma Awards were conferred for 2026: 5 Padma Vibhushan, 13 Padma Bhushan, and 113 Padma Shri.',tags:['padma-awards','india'],imp:true},
  {q:'Which actor received Padma Bhushan in 2026?',o:['Mammootty','Rajinikanth','Amitabh Bachchan','Chiranjeevi'],a:0,cat:'Awards',exp:'Mammootty received the Padma Bhushan in 2026 for his contribution to art.',tags:['padma-awards','cinema'],imp:true},
  {q:'Who among the following received Padma Shri in 2026 for sports?',o:['Rohit Sharma','Virat Kohli','MS Dhoni','Neeraj Chopra'],a:0,cat:'Sports',exp:'Rohit Sharma received the Padma Shri in 2026 for his contribution to cricket.',tags:['padma-awards','cricket','sports'],imp:true},
  {q:'How many Padma Vibhushan awards were given in 2026?',o:['5','7','3','10'],a:0,cat:'Awards',exp:'5 Padma Vibhushan awards were conferred in 2026.',tags:['padma-awards'],imp:false},
  {q:'Who presented the Union Budget 2026-27?',o:['Nirmala Sitharaman','Piyush Goyal','Arun Jaitley','Pranab Mukherjee'],a:0,cat:'Economy',exp:'Finance Minister Nirmala Sitharaman presented the Union Budget 2026-27 on February 1, 2026.',tags:['budget','economy'],imp:true},
  {q:'What was India GDP growth projection for FY26 as per Budget 2026-27?',o:['7.4%','6.5%','8.2%','5.8%'],a:0,cat:'Economy',exp:'India GDP growth was projected at 7.4% for FY26 as per the Union Budget 2026-27.',tags:['gdp','economy','budget'],imp:true},
  {q:'Which new scheme was launched in Union Budget 2026-27 for rare earth materials?',o:['Rare Earth Permanent Magnets Scheme','National Mineral Mission','Critical Minerals Mission','Mining Tech Scheme'],a:0,cat:'Government Schemes',exp:'The Rare Earth Permanent Magnets Scheme was launched in the Union Budget 2026-27 to reduce import dependency.',tags:['rare-earth','manufacturing','budget'],imp:false},
  {q:'The Vande Mataram Protection Bill grants the national song the same legal protection as which of the following?',o:['The National Anthem (Jana Gana Mana)','The National Flag','The Constitution','The State Emblem'],a:0,cat:'Polity',exp:'The Prevention of Insults to National Honour (Amendment) Bill, 2026 grants Vande Mataram the same legal protection as the National Anthem, Jana Gana Mana.',tags:['vande-mataram','national-song','polity'],imp:true},
  {q:'Who gave assent to the Vande Mataram Protection Bill in 2026?',o:['President Droupadi Murmu','Prime Minister Narendra Modi','Parliament Speaker','Chief Justice of India'],a:0,cat:'Polity',exp:'President Droupadi Murmu gave assent to the Vande Mataram Protection Bill in August 2026.',tags:['president','polity','bill'],imp:true},
  {q:'Glaw Lake was designated as India what number Ramsar Site in 2026?',o:['101st','99th','80th','75th'],a:0,cat:'Environment',exp:'Glaw Lake was officially designated as India 101st Ramsar Site in 2026.',tags:['ramsar','wetland','environment'],imp:true},
  {q:'SBI Research projected India GDP growth at what percentage for Q1 FY27?',o:['8%','7%','9%','6.5%'],a:0,cat:'Economy',exp:'SBI Research projected India GDP growth at approximately 8% for Q1 FY27, higher than RBI projection of 7%.',tags:['gdp','sbi','economy'],imp:true},
  {q:'Under Orunodoi Scheme 3.0, how much monthly assistance is provided to women in Assam?',o:['Rs.1,250','Rs.1,000','Rs.1,500','Rs.2,000'],a:0,cat:'Government Schemes',exp:'Under Orunodoi Scheme 3.0, 37.1 lakh women receive Rs.1,250 per month through DBT from August 2026.',tags:['orunodoi','assam','welfare'],imp:true},
  {q:'How many women beneficiaries are covered under Orunodoi Scheme 3.0?',o:['37.1 lakh','19.1 lakh','25 lakh','50 lakh'],a:0,cat:'Government Schemes',exp:'Orunodoi Scheme 3.0 covers 37.1 lakh women beneficiaries in Assam.',tags:['orunodoi','assam','welfare'],imp:true},
  {q:'A magnitude 5.1 earthquake struck Assam in which month of 2026?',o:['January','March','June','September'],a:0,cat:'Assam',exp:'A magnitude 5.1 earthquake struck Assam in January 2026, with the epicenter near Tezpur.',tags:['assam','earthquake','disaster'],imp:false},
  {q:'Assam floods in 2026 primarily affected which river basin?',o:['Brahmaputra','Barak','Subansiri','Dibang'],a:0,cat:'Assam',exp:'The July 2026 Assam floods primarily affected the Brahmaputra river basin, with the river flowing above danger level in multiple districts.',tags:['assam','floods','brahmaputra'],imp:true},
  {q:'India is hosting which BRICS Summit in September 2026?',o:['18th','17th','16th','19th'],a:0,cat:'International Relations',exp:'India is hosting the 18th BRICS Summit in New Delhi on September 12-13, 2026.',tags:['brics','india','summit'],imp:true},
  {q:'Where will the 18th BRICS Summit 2026 be held?',o:['New Delhi','Mumbai','Chennai','Kolkata'],a:0,cat:'International Relations',exp:'The 18th BRICS Summit 2026 will be held in New Delhi on September 12-13, 2026.',tags:['brics','new-delhi'],imp:false},
  {q:'The 20th Asian Games 2026 will be hosted by which country?',o:['Japan','China','South Korea','India'],a:0,cat:'Sports',exp:'The 20th Asian Games 2026 will be hosted by Aichi-Nagoya, Japan.',tags:['asian-games','sports','japan'],imp:true},
  {q:'How many medals did India win at the previous Asian Games (2022 Hangzhou)?',o:['107','80','92','98'],a:0,cat:'Sports',exp:'India won 107 medals (28 gold, 38 silver, 41 bronze) at the 2022 Asian Games in Hangzhou, its best performance ever.',tags:['asian-games','india','medals'],imp:true},
  {q:'IBM partnered with which Indian institutions to establish AI centres in 2026?',o:['MIT Bengaluru and Christ University','IIT Delhi and IIT Bombay','IISc and NIT Trichy','BITS Pilani and VIT'],a:0,cat:'Science & Technology',exp:'IBM partnered with MIT Bengaluru (MAHE) and Christ University to establish AI-focused research centres in India in August 2026.',tags:['ibm','ai','technology'],imp:false},
  {q:'India surpassed which country in solar capacity addition by adding 37 GW in 2025?',o:['United States','China','Germany','Japan'],a:0,cat:'Environment',exp:'India surpassed the United States by adding 37 GW of solar capacity in 2025.',tags:['solar','renewable-energy','india'],imp:false},
  {q:'How many tourists visited Assam in 2026 (approximate)?',o:['85 lakh','50 lakh','20 lakh','1 crore'],a:0,cat:'Assam',exp:'Over 85 lakh tourists including approximately 47,000 foreign tourists visited Assam in 2026.',tags:['assam','tourism'],imp:false},
  {q:'India celebrated its Republic Day for which time in 2026?',o:['77th','75th','76th','78th'],a:0,cat:'India',exp:'India celebrated its 77th Republic Day on January 26, 2026.',tags:['republic-day','india'],imp:true},
  {q:'How many posthumous Padma Awards were given in 2026?',o:['16','10','12','20'],a:0,cat:'Awards',exp:'16 posthumous awardees were included in the 131 Padma Awards for 2026.',tags:['padma-awards'],imp:false}
];

/* ═══════════════════════════════════════════════════════════════
   BRAINLAB EXTENSION METHODS
   Safely extend BrainLab without modifying the original object
   ═══════════════════════════════════════════════════════════════ */

/* ── 1. ENHANCED DAILY CHALLENGE RENDER ── */
BrainLab._origRenderDailyChallenge = BrainLab.renderDailyChallenge;
BrainLab.renderDailyChallenge = function(){
  var c=document.getElementById('bl-daily-challenge');
  if(!c)return;
  var s=this;
  var pool=this.filterQuestions({category:'All'});
  if(!pool.length){
    c.innerHTML='<div class="bl-section-header"><h2 class="bl-section-title">Daily Challenge</h2><span class="bl-section-sub">10 fresh questions every day</span></div><div class="bl-empty bl-fade-in"><div class="bl-empty-icon">⚡</div><div class="bl-empty-text">Questions are loading. Please try again in a moment.</div></div>';
    return;
  }
  var status=s.getDailyStatus();
  var streak=s.dayStreak();
  var h='<div class="bl-section-header"><h2 class="bl-section-title">Daily Challenge</h2><span class="bl-section-sub">10 fresh questions every day</span></div>';
  if(status){
    h+='<div class="bl-daily-card bl-daily-completed">';
    h+='<div class="bl-daily-icon">✅</div>';
    h+='<div class="bl-daily-info">';
    h+='<h3>Today\'s Challenge Complete!</h3>';
    h+='<p>You scored <strong>'+status.score+'%</strong> ('+status.correct+'/'+status.total+' correct)</p>';
    h+='<p class="bl-daily-time">Completed at '+new Date(status.completed_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})+'</p>';
    h+='</div>';
    h+='<button class="bl-daily-btn" onclick="BrainLab.startDailyChallenge()">Retry Today</button>';
    h+='</div>';
    h+='<div class="bl-daily-stats-bar">';
    h+='<div class="bl-daily-mini-stat"><span class="bl-daily-mini-icon">🔥</span><span class="bl-daily-mini-num">'+streak+'</span><span class="bl-daily-mini-label">Day Streak</span></div>';
    h+='<div class="bl-daily-mini-stat"><span class="bl-daily-mini-icon">🎯</span><span class="bl-daily-mini-num">'+status.score+'%</span><span class="bl-daily-mini-label">Today\'s Score</span></div>';
    h+='<div class="bl-daily-mini-stat"><span class="bl-daily-mini-icon">✅</span><span class="bl-daily-mini-num">'+status.correct+'</span><span class="bl-daily-mini-label">Correct</span></div>';
    h+='</div>';
  } else {
    h+='<div class="bl-daily-card" onclick="BrainLab.startDailyChallenge()">';
    h+='<div class="bl-daily-icon">⚡</div>';
    h+='<div class="bl-daily-info">';
    h+='<h3>Today\'s Challenge</h3>';
    h+='<p>10 mixed questions · ~10 min · Build your streak</p>';
    h+='</div>';
    h+='<button class="bl-daily-btn">Start Now</button>';
    h+='</div>';
    h+='<div class="bl-daily-stats-bar">';
    h+='<div class="bl-daily-mini-stat"><span class="bl-daily-mini-icon">🔥</span><span class="bl-daily-mini-num">'+streak+'</span><span class="bl-daily-mini-label">Day Streak</span></div>';
    h+='<div class="bl-daily-mini-stat"><span class="bl-daily-mini-icon">📋</span><span class="bl-daily-mini-num">10</span><span class="bl-daily-mini-label">Questions</span></div>';
    h+='<div class="bl-daily-mini-stat"><span class="bl-daily-mini-icon">⏱️</span><span class="bl-daily-mini-num">~10min</span><span class="bl-daily-mini-label">Est. Time</span></div>';
    h+='</div>';
  }
  c.innerHTML=h;
};

/* ── 2. CURRENT AFFAIRS 2026 SYSTEM ── */
BrainLab._origRenderCurrentAffairs = BrainLab.renderCurrentAffairs;
BrainLab.renderCurrentAffairs = function(){
  var c=document.getElementById('bl-affairs');
  if(!c)return;
  var s=this;
  var cl=this.client();
  function renderWithData(serverData){
    var allData=(serverData||[]).concat(CA_2026||[]);
    var seen={};
    allData=allData.filter(function(item){
      var key=item.title||item.headline||'';
      if(seen[key])return false;
      seen[key]=true;
      return true;
    });
    allData.sort(function(a,b){
      var da=a.date||a.created_at||'';
      var db=b.date||b.created_at||'';
      return db.localeCompare(da);
    });
    s._renderCurrentAffairsV2(c,allData);
  }
  if(cl){
    cl.from('current_affairs').select('*').eq('is_deleted',false).order('created_at',{ascending:false}).limit(30)
      .then(function(r){renderWithData(r.data||[]);})
      .catch(function(){renderWithData([]);});
  } else {
    renderWithData([]);
  }
};

BrainLab._caFilter={search:'',category:'All',month:'All',importantOnly:false};

BrainLab._renderCurrentAffairsV2=function(c,data){
  var s=this;
  var categories=['All','Assam','India','World','Polity','Economy','Government Schemes','Appointments','Awards','Sports','Science & Technology','Environment','Defence','International Relations','Important Days','Books & Authors','Reports & Indexes','Business','Banking','Agriculture','Geography','Miscellaneous'];
  var months=['All','January','February','March','April','May','June','July','August','September','October','November','December'];
  var monthMap={'January':'01','February':'02','March':'03','April':'04','May':'05','June':'06','July':'07','August':'08','September':'09','October':'10','November':'11','December':'12'};
  var h='<div class="bl-section-header"><h2 class="bl-section-title">Current Affairs 2026</h2><span class="bl-section-sub">'+data.length+' items</span></div>';
  h+='<div class="bl-ca-search-wrap">';
  h+='<input type="text" class="bl-ca-search" id="bl-ca-search" placeholder="Search current affairs..." value="'+(this._caFilter.search||'')+'" oninput="BrainLab._caFilterSearch(this.value)">';
  h+='</div>';
  h+='<div class="bl-ca-chips-wrap"><div class="bl-ca-chips">';
  categories.forEach(function(cat){
    var active=(s._caFilter.category===cat)?' bl-ca-chip-active':'';
    h+='<button class="bl-ca-chip'+active+'" onclick="BrainLab._caFilterCategory(\''+cat+'\')">'+cat+'</button>';
  });
  h+='</div></div>';
  h+='<div class="bl-ca-filters-row">';
  h+='<select class="bl-ca-month-sel" id="bl-ca-month" onchange="BrainLab._caFilterMonth(this.value)">';
  months.forEach(function(m){
    var sel=(s._caFilter.month===m)?' selected':'';
    h+='<option value="'+m+'"'+sel+'>'+m+'</option>';
  });
  h+='</select>';
  h+='<label class="bl-ca-important-toggle"><input type="checkbox" id="bl-ca-important" '+(this._caFilter.importantOnly?'checked':'')+' onchange="BrainLab._caFilterImportant(this.checked)"><span>⭐ Important Only</span></label>';
  h+='</div>';
  h+='<div class="bl-ca-actions">';
  h+='<button class="bl-ca-action-btn" onclick="BrainLab._caStartQuiz(10)">📝 Create Quiz</button>';
  h+='<button class="bl-ca-action-btn" onclick="BrainLab._caStartQuiz(20)">📋 Create MCQs</button>';
  h+='<button class="bl-ca-action-btn" onclick="BrainLab._caStartQuiz(30)">📊 Mock Test</button>';
  h+='<button class="bl-ca-action-btn bl-ca-action-imp" onclick="BrainLab._caPracticeImportant()">⭐ Practice Important</button>';
  h+='</div>';
  var filtered=data.filter(function(item){
    var title=item.title||item.headline||'';
    var summary=item.summary||item.description||'';
    var search=s._caFilter.search.toLowerCase();
    if(search&&title.toLowerCase().indexOf(search)<0&&summary.toLowerCase().indexOf(search)<0)return false;
    if(s._caFilter.category!=='All'&&item.category!==s._caFilter.category)return false;
    if(s._caFilter.month!=='All'){
      var mn=monthMap[s._caFilter.month]||'';
      var idate=item.date||'';
      if(item.month!==s._caFilter.month&&!idate.startsWith(mn))return false;
    }
    if(s._caFilter.importantOnly&&item.importance!=='high')return false;
    return true;
  });
  if(!filtered.length){
    h+='<div class="bl-empty bl-fade-in"><div class="bl-empty-icon">📰</div><div class="bl-empty-text">No current affairs match your filters. Try adjusting your search.</div></div>';
  } else {
    h+='<div class="bl-ca-list">';
    filtered.forEach(function(item,idx){
      var isImp=item.importance==='high';
      h+='<div class="bl-ca-card'+(isImp?' bl-ca-card-imp':'')+'">';
      if(isImp)h+='<span class="bl-ca-imp-badge">⭐ High Yield</span>';
      h+='<div class="bl-ca-card-header">';
      h+='<span class="bl-ca-date">'+(item.date||'').split('T')[0]+'</span>';
      h+='<span class="bl-ca-cat-badge">'+(item.category||'Miscellaneous')+'</span>';
      h+='</div>';
      h+='<h4 class="bl-ca-title">'+s.escape(item.title||'')+'</h4>';
      h+='<p class="bl-ca-summary">'+s.escape(item.summary||item.description||'')+'</p>';
      if(item.facts&&item.facts.length){
        h+='<div class="bl-ca-facts"><h5>Key Facts:</h5><ul>';
        item.facts.forEach(function(f){h+='<li>'+s.escape(f)+'</li>';});
        h+='</ul></div>';
      }
      if(item.tags&&item.tags.length){
        h+='<div class="bl-ca-tags">';
        item.tags.forEach(function(t){h+='<span class="bl-ca-tag">#'+s.escape(t)+'</span>';});
        h+='</div>';
      }
      if(item.source){h+='<div class="bl-ca-source">Source: '+s.escape(item.source)+'</div>';}
      h+='</div>';
    });
    h+='</div>';
  }
  c.innerHTML=h;
};

BrainLab._caFilterSearch=function(val){this._caFilter.search=val;this.renderCurrentAffairs();};
BrainLab._caFilterCategory=function(cat){this._caFilter.category=cat;this.renderCurrentAffairs();};
BrainLab._caFilterMonth=function(month){this._caFilter.month=month;this.renderCurrentAffairs();};
BrainLab._caFilterImportant=function(imp){this._caFilter.importantOnly=imp;this.renderCurrentAffairs();};

BrainLab._caStartQuiz=function(count){
  if(!CA_QUIZ||!CA_QUIZ.length){this.toast('No current affairs questions available.');return;}
  var pool=CA_QUIZ.slice();
  if(this._caFilter.category!=='All'){pool=pool.filter(function(q){return q.cat===BrainLab._caFilter.category;});}
  if(this._caFilter.importantOnly){pool=pool.filter(function(q){return q.imp===true;});}
  if(!pool.length){this.toast('No questions match your filter. Showing all.');pool=CA_QUIZ.slice();}
  var shuffled=this.shuffle(pool);
  var selected=shuffled.slice(0,Math.min(count,shuffled.length));
  var qs=selected.map(function(item,i){
    return{id:'ca-'+i+'-'+Date.now(),question_text:item.q,option_a:item.o[0],option_b:item.o[1],option_c:item.o[2],option_d:item.o[3],correct_answer:['a','b','c','d'][item.a],explanation:item.exp,topic:'Current Affairs',category:item.cat,difficulty:'mixed',exam_tags:'Current Affairs 2026',question_type:'MCQ',source:'Current Affairs 2026'};
  });
  var sessionId='sess-'+Date.now()+'-'+Math.random().toString(36).slice(2,7);
  this._sessionId=sessionId;
  this._sessionMeta={id:sessionId,mode:count>=30?'mock':count>=20?'mcq':'quiz',title:'Current Affairs '+count+' Questions',category:'Current Affairs',topic:'All',exam:'All',difficulty:'mixed',total_questions:qs.length,started_at:new Date().toISOString()};
  this._startPlayer({title:'Current Affairs Quiz ('+qs.length+' Q)',questions:qs,mode:count>=30?'mock':'quiz'});
};

BrainLab._caPracticeImportant=function(){
  if(!CA_QUIZ||!CA_QUIZ.length){this.toast('No important current affairs questions available.');return;}
  var pool=CA_QUIZ.filter(function(q){return q.imp===true;});
  if(!pool.length){pool=CA_QUIZ.slice();}
  var shuffled=this.shuffle(pool);
  var selected=shuffled.slice(0,Math.min(15,shuffled.length));
  var qs=selected.map(function(item,i){
    return{id:'cai-'+i+'-'+Date.now(),question_text:item.q,option_a:item.o[0],option_b:item.o[1],option_c:item.o[2],option_d:item.o[3],correct_answer:['a','b','c','d'][item.a],explanation:item.exp,topic:'Current Affairs',category:item.cat,difficulty:'mixed',exam_tags:'Current Affairs 2026',question_type:'MCQ',source:'Current Affairs 2026'};
  });
  var sessionId='sess-'+Date.now()+'-'+Math.random().toString(36).slice(2,7);
  this._sessionId=sessionId;
  this._sessionMeta={id:sessionId,mode:'quiz',title:'Important Current Affairs Practice',category:'Current Affairs',topic:'All',exam:'All',difficulty:'mixed',total_questions:qs.length,started_at:new Date().toISOString()};
  this._startPlayer({title:'Important Current Affairs ('+qs.length+' Q)',questions:qs,mode:'quiz'});
};

/* ── 3. MISTAKE BOOK 2.0 ── */
BrainLab._origSaveMistakeLocal=BrainLab.saveMistakeLocal;
BrainLab.saveMistakeLocal=function(q,ua){
  try{
    var m=this.getMistakes();
    var existing=m.findIndex(function(item){return item.question_text===q.question_text;});
    if(existing>=0){
      m[existing].attempt_count=(m[existing].attempt_count||1)+1;
      m[existing].last_attempted=new Date().toISOString();
      m[existing].user_answer=ua;
      m[existing].correct_answer=q.correct_answer;
      m[existing].explanation=q.explanation||m[existing].explanation;
      m[existing].topic=q.topic||m[existing].topic;
      m[existing].category=q.category||m[existing].category;
      m[existing].difficulty=q.difficulty||m[existing].difficulty;
      m[existing].source=q.source||m[existing].source||'quiz';
      m[existing].exam=q.exam_tags||m[existing].exam||'';
      var item=m.splice(existing,1)[0];
      m.unshift(item);
    } else {
      m.unshift({question_text:q.question_text,user_answer:ua,correct_answer:q.correct_answer,explanation:q.explanation,topic:q.topic,category:q.category,difficulty:q.difficulty||'mixed',source:q.source||'quiz',exam:q.exam_tags||'',created_at:new Date().toISOString(),last_attempted:new Date().toISOString(),attempt_count:1,reviewed:false,correct_history:[false]});
    }
    if(m.length>200)m=m.slice(0,200);
    localStorage.setItem('bl_mistakes',JSON.stringify(m));
  }catch(e){
    this._origSaveMistakeLocal(q,ua);
  }
};

BrainLab._mbFilter={search:'',filter:'All',exam:'All',category:'All'};

BrainLab._origRenderMistakes=BrainLab.renderMistakes;
BrainLab.renderMistakes=function(){
  var c=document.getElementById('bl-mistakes');
  if(!c)return;
  var s=this;
  var mistakes=this.getMistakes();
  if(!mistakes.length){
    c.innerHTML='<div class="bl-section-header"><h2 class="bl-section-title">Mistake Book 2.0</h2></div><div class="bl-empty bl-fade-in"><div class="bl-empty-icon">🎯</div><div class="bl-empty-text">No mistakes recorded yet. Take a quiz to build your mistake book!</div><button class="bl-empty-action" onclick="BrainLab.scrollToSection(\'bl-sec-quizzes\')">Start a Quiz</button></div>';
    return;
  }
  mistakes=mistakes.map(function(m){
    if(m.reviewed===undefined)m.reviewed=false;
    if(m.attempt_count===undefined)m.attempt_count=1;
    if(!m.last_attempted)m.last_attempted=m.created_at;
    if(!m.correct_history)m.correct_history=[false];
    return m;
  });
  var total=mistakes.length;
  var unreviewed=mistakes.filter(function(m){return !m.reviewed;}).length;
  var reviewed=mistakes.filter(function(m){return m.reviewed;}).length;
  var frequent=mistakes.filter(function(m){return(m.attempt_count||1)>=2;}).length;
  var topicCount={};
  mistakes.forEach(function(m){var t=m.topic||m.category||'Unknown';topicCount[t]=(topicCount[t]||0)+1;});
  var topTopic=Object.keys(topicCount).sort(function(a,b){return topicCount[b]-topicCount[a];})[0]||'None';
  var filters=['All','Unreviewed','Reviewed','Frequently Wrong','Recently Wrong'];
  var h='<div class="bl-section-header"><h2 class="bl-section-title">Mistake Book 2.0</h2><span class="bl-section-sub">'+total+' mistakes</span></div>';
  h+='<div class="bl-mb-stats">';
  h+='<div class="bl-mb-stat"><div class="bl-mb-stat-num">'+total+'</div><div class="bl-mb-stat-label">Total</div></div>';
  h+='<div class="bl-mb-stat"><div class="bl-mb-stat-num">'+unreviewed+'</div><div class="bl-mb-stat-label">Unreviewed</div></div>';
  h+='<div class="bl-mb-stat"><div class="bl-mb-stat-num">'+reviewed+'</div><div class="bl-mb-stat-label">Reviewed</div></div>';
  h+='<div class="bl-mb-stat"><div class="bl-mb-stat-num">'+frequent+'</div><div class="bl-mb-stat-label">Frequent</div></div>';
  h+='</div>';
  h+='<div class="bl-mb-topic">Most difficult topic: <strong>'+this.escape(topTopic)+'</strong> ('+(topicCount[topTopic]||0)+' mistakes)</div>';
  h+='<div class="bl-mb-search-wrap">';
  h+='<input type="text" class="bl-mb-search" placeholder="Search mistakes..." value="'+(this._mbFilter.search||'')+'" oninput="BrainLab._mbFilterSearch(this.value)">';
  h+='</div>';
  h+='<div class="bl-mb-chips-wrap"><div class="bl-mb-chips">';
  filters.forEach(function(f){
    var active=(s._mbFilter.filter===f)?' bl-mb-chip-active':'';
    h+='<button class="bl-mb-chip'+active+'" onclick="BrainLab._mbSetFilter(\''+f+'\')">'+f+'</button>';
  });
  h+='</div></div>';
  var filtered=mistakes.filter(function(m){
    var search=s._mbFilter.search.toLowerCase();
    if(search){
      var qt=(m.question_text||'').toLowerCase();
      var tp=(m.topic||'').toLowerCase();
      var ct=(m.category||'').toLowerCase();
      if(qt.indexOf(search)<0&&tp.indexOf(search)<0&&ct.indexOf(search)<0)return false;
    }
    var f=s._mbFilter.filter;
    if(f==='Unreviewed'&&m.reviewed)return false;
    if(f==='Reviewed'&&!m.reviewed)return false;
    if(f==='Frequently Wrong'&&(m.attempt_count||1)<2)return false;
    if(f==='Recently Wrong'){
      var weekAgo=Date.now()-7*24*60*60*1000;
      var mDate=new Date(m.last_attempted||m.created_at).getTime();
      if(mDate<weekAgo)return false;
    }
    return true;
  });
  if(!filtered.length){
    h+='<div class="bl-empty bl-fade-in"><div class="bl-empty-icon">🔍</div><div class="bl-empty-text">No mistakes match this filter.</div></div>';
  } else {
    h+='<div class="bl-mb-list">';
    filtered.slice(0,50).forEach(function(m,i){
      var ua=m.user_answer||'-';
      if(ua==='a')ua='A';if(ua==='b')ua='B';if(ua==='c')ua='C';if(ua==='d')ua='D';
      var ca=m.correct_answer||'-';
      if(ca==='a')ca='A';if(ca==='b')ca='B';if(ca==='c')ca='C';if(ca==='d')ca='D';
      var reviewed=m.reviewed?' bl-mb-item-reviewed':'';
      var freq=(m.attempt_count||1)>=2?' bl-mb-item-frequent':'';
      var origIdx=mistakes.indexOf(m);
      h+='<div class="bl-mb-item'+reviewed+freq+'">';
      h+='<div class="bl-mb-item-header">';
      h+='<span class="bl-mb-item-num">#'+(i+1)+'</span>';
      if(m.category)h+='<span class="bl-mb-cat-badge">'+s.escape(m.category)+'</span>';
      if((m.attempt_count||1)>=2)h+='<span class="bl-mb-freq-badge">⚠️ ×'+m.attempt_count+'</span>';
      if(m.reviewed)h+='<span class="bl-mb-reviewed-badge">✓ Reviewed</span>';
      h+='</div>';
      h+='<div class="bl-mb-q">'+(i+1)+'. '+s.escape(m.question_text)+'</div>';
      h+='<div class="bl-mb-ans"><span class="bl-mb-wrong">Your answer: '+ua+'</span><span class="bl-mb-correct">Correct: '+ca+'</span></div>';
      if(m.topic)h+='<div class="bl-mb-topic-line">Topic: '+s.escape(m.topic)+'</div>';
      if(m.explanation)h+='<div class="bl-mb-exp">'+s.escape(m.explanation)+'</div>';
      h+='<div class="bl-mb-item-actions">';
      h+='<button class="bl-mb-act-btn bl-mb-act-review" onclick="BrainLab._mbToggleReview('+origIdx+')">'+(m.reviewed?'Mark Unreviewed':'Mark Reviewed')+'</button>';
      h+='<button class="bl-mb-act-btn bl-mb-act-practice" onclick="BrainLab._mbRetrySingle('+origIdx+')">Practice Again</button>';
      h+='<button class="bl-mb-act-btn bl-mb-act-remove" onclick="BrainLab._mbRemove('+origIdx+')">Remove</button>';
      h+='</div>';
      h+='</div>';
    });
    h+='</div>';
  }
  h+='<div class="bl-mb-bulk-actions">';
  h+='<button class="bl-mb-bulk-btn" onclick="BrainLab.retryMistakes()">📚 Practice All Mistakes</button>';
  h+='<button class="bl-mb-bulk-btn bl-mb-bulk-clear" onclick="BrainLab.clearMistakes()">🗑 Clear All</button>';
  h+='</div>';
  c.innerHTML=h;
};

BrainLab._mbFilterSearch=function(val){this._mbFilter.search=val;this.renderMistakes();};
BrainLab._mbSetFilter=function(f){this._mbFilter.filter=f;this.renderMistakes();};
BrainLab._mbToggleReview=function(idx){
  var m=this.getMistakes();
  if(m[idx]){m[idx].reviewed=!m[idx].reviewed;localStorage.setItem('bl_mistakes',JSON.stringify(m));this.renderMistakes();this.toast(m[idx].reviewed?'Marked as reviewed':'Marked as unreviewed');}
};
BrainLab._mbRemove=function(idx){
  var m=this.getMistakes();m.splice(idx,1);localStorage.setItem('bl_mistakes',JSON.stringify(m));this.renderMistakes();this.toast('Removed from Mistake Book');
};
BrainLab._mbRetrySingle=function(idx){
  var m=this.getMistakes();
  if(!m[idx])return;
  var mistake=m[idx];
  var qs=[{id:'mb-retry-'+idx+'-'+Date.now(),question_text:mistake.question_text,option_a:'A',option_b:'B',option_c:'C',option_d:'D',correct_answer:mistake.correct_answer,explanation:mistake.explanation||'',topic:mistake.topic||'',category:mistake.category||'',difficulty:'mixed',question_type:'MCQ',source:mistake.source||'mistake-book'}];
  this._startPlayer({title:'Practice This Question',questions:qs,mode:'mistakes'});
};
