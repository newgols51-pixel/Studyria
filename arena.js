// ═══════════════════════════════════════════════════════════════════════
// STUDYRIA ARENA — COMPETITIVE LEARNING ENGINE
// arena.js — Matchmaking, Battle Engine, Opponent AI, Rating System
// ═══════════════════════════════════════════════════════════════════════
(function() {
'use strict';
window.ARENA = window.ARENA || {};
const S = {
    page:'lobby',mode:'1v1',exam:'ADRE',category:'GK',difficulty:'medium',
    questionCount:10,opponents:[],matchOpponent:null,matchId:null,matchCode:null,
    questions:[],currentQ:0,userAnswers:[],userScore:0,userCorrect:0,
    opponentScore:0,opponentCorrect:0,opponentAnswers:[],timer:null,timeLeft:30,
    matchStartTime:null,searchInterval:null,searchSeconds:0,soundEnabled:true,teamOpponents:null,
    stats:null,history:[],leaderboard:[],recentForm:[],currentStreak:0,bestStreak:0,rating:1000
};

// ── QUESTION BANK ─────────────────────────────────────────────────────
const QUESTION_BANK = {
    'ADRE': {
        'GK': {
            easy: [
                {q:"What is the capital of Assam?",a:["Dispur","Guwahati","Dibrugarh","Jorhat"],correct:0,topic:"GK"},
                {q:"Which river is known as the lifeline of Assam?",a:["Brahmaputra","Barak","Subansiri","Dhansiri"],correct:0,topic:"GK"},
                {q:"How many districts are there in Assam (as of 2024)?",a:["33","35","31","38"],correct:1,topic:"GK"},
                {q:"Which is the largest freshwater island in the world, located in Assam?",a:["Majuli","Umananda","Peacock Island","Patumbari"],correct:0,topic:"GK"},
                {q:"What is the state animal of Assam?",a:["One-horned Rhino","Tiger","Elephant","Wild Buffalo"],correct:0,topic:"GK"}
            ],
            medium: [
                {q:"When did the Battle of Saraighat take place?",a:["1671","1826","1857","1947"],correct:0,topic:"History"},
                {q:"Who led the Ahom forces in the Battle of Saraighat?",a:["Lachit Borphukan","Chilarai","Rudra Singha","Gadadhar Singha"],correct:0,topic:"History"},
                {q:"The Assam Movement (1979-1985) was primarily about which issue?",a:["Foreign nationals deportation","Language rights","Tea garden workers","Bodoland state"],correct:0,topic:"Current Affairs"},
                {q:"Which dynasty ruled Assam for nearly 600 years?",a:["Ahom","Koch","Kamarupa","Mughal"],correct:0,topic:"History"},
                {q:"Kaziranga National Park is famous for which animal?",a:["One-horned Rhino","Bengal Tiger","Asian Elephant","Hoolock Gibbon"],correct:0,topic:"GK"},
                {q:"Who composed the Assamese poem 'Burhi Aair Sadhu'?",a:["Lakshminath Bezbaroa","Jyoti Prasad Agarwala","Bishnu Prasad Rabha","Hem Barua"],correct:0,topic:"History"},
                {q:"Which treaty ceded Assam to the British in 1826?",a:["Treaty of Yandaboo","Treaty of Titalia","Treaty of Sagauli","Treaty of Allahabad"],correct:0,topic:"History"},
                {q:"What is the highest mountain peak in Assam?",a:["Nilam Parbat","Tiger Hill","Saramati","Kangto"],correct:0,topic:"Geography"}
            ],
            hard: [
                {q:"In which year was the Assam Association formed?",a:["1903","1911","1921","1937"],correct:0,topic:"History"},
                {q:"Who was the first Chief Minister of Assam?",a:["Gopinath Bordoloi","Bishnu Ram Medhi","Sarat Chandra Sinha","Tarun Gogoi"],correct:0,topic:"Polity"},
                {q:"The Assam Accord was signed in which year?",a:["1985","1979","1980","1990"],correct:0,topic:"Current Affairs"},
                {q:"Which article of the Constitution deals with the special provisions for Assam?",a:["Article 371B","Article 371A","Article 356","Article 244"],correct:0,topic:"Polity"},
                {q:"What percentage of India's total tea production comes from Assam?",a:["~52%","~33%","~25%","~70%"],correct:0,topic:"Economy"},
                {q:"Which Ahom king shifted the capital to Rangpur?",a:["Rudra Singha","Sukapha","Pramatta Singha","Rajeswar Singha"],correct:0,topic:"History"},
                {q:"The Dehing Patkai rainforest is located in which district?",a:["Dibrugarh","Tinsukia","Sivasagar","Jorhat"],correct:0,topic:"Geography"},
                {q:"Who led the Quit India Movement in Assam?",a:["Gopinath Bordoloi","Rohini Kumar Barua","Bishnu Ram Medhi","Fakhruddin Ali Ahmed"],correct:0,topic:"History"}
            ]
        },
        'History': {
            easy: [
                {q:"Who founded the Ahom kingdom?",a:["Sukapha","Suhungmung","Pramatta Singha","Sukampha"],correct:0,topic:"History"},
                {q:"In which year did Sukapha establish the Ahom kingdom?",a:["1228","1253","1287","1300"],correct:0,topic:"History"},
                {q:"Which Mughal general was defeated at Saraighat?",a:["Ram Singh","Mir Jumla","Shaista Khan","Aurangzeb"],correct:0,topic:"History"},
                {q:"Who was the last Ahom king?",a:["Purandar Singha","Chandrakanta Singha","Sudangphaa","Suklingphaa"],correct:0,topic:"History"},
                {q:"The Moamoria Rebellion was against which dynasty?",a:["Ahom","Koch","Kachari","Mughal"],correct:0,topic:"History"}
            ],
            medium: [
                {q:"Who built the Rang Ghar in Sivasagar?",a:["Pramatta Singha","Rudra Singha","Sukapha","Rajeswar Singha"],correct:0,topic:"History"},
                {q:"The Buranjis are historical chronicles of which kingdom?",a:["Ahom","Koch","Kachari","Chutiya"],correct:0,topic:"History"},
                {q:"Who was the architect of the Talatal Ghar?",a:["Rajeswar Singha","Rudra Singha","Sukapha","Gaurinath Singha"],correct:0,topic:"History"},
                {q:"Which battle ended Ahom sovereignty in Assam?",a:["Battle of Itakhuli","Battle of Saraighat","Moamoria Rebellion","Treaty of Yandaboo"],correct:3,topic:"History"},
                {q:"Jaymati Kunwari was the wife of which Ahom prince?",a:["Gadapani","Lora Raja","Sukapha","Suhungmung"],correct:0,topic:"History"}
            ],
            hard: [
                {q:"The Padmini legend of the Koch kingdom relates to which ruler?",a:["Naranarayan","Viswa Singha","Chilarai","Parikshit Narayan"],correct:0,topic:"History"},
                {q:"Which Ahom king adopted Hinduism formally?",a:["Suhungmung","Sukapha","Rudra Singha","Pramatta Singha"],correct:0,topic:"History"},
                {q:"The Baro-Bhuyans were feudal lords in which region of Assam?",a:["Western Assam","Upper Assam","Barak Valley","Brahmaputra Valley"],correct:0,topic:"History"},
                {q:"Who wrote the 'Assam Buranji' during British rule?",a:["Haliram Dhekial Phukan","Anandaram Dhekial Phukan","Gunabhiram Barua","Lakshminath Bezbaroa"],correct:0,topic:"History"}
            ]
        },
        'Polity': {
            easy: [
                {q:"How many Lok Sabha seats are there in Assam?",a:["14","7","21","11"],correct:0,topic:"Polity"},
                {q:"How many Rajya Sabha seats are there in Assam?",a:["7","14","10","5"],correct:0,topic:"Polity"},
                {q:"Which is the High Court of Assam?",a:["Gauhati High Court","Assam High Court","Dispur High Court","Brahmaputra High Court"],correct:0,topic:"Polity"},
                {q:"Who appoints the Governor of Assam?",a:["President of India","Prime Minister","Chief Minister","Chief Justice"],correct:0,topic:"Polity"},
                {q:"What is the term of the Assam Legislative Assembly?",a:["5 years","4 years","6 years","3 years"],correct:0,topic:"Polity"}
            ],
            medium: [
                {q:"Article 371B provides special provisions for which state?",a:["Assam","Nagaland","Manipur","Meghalaya"],correct:0,topic:"Polity"},
                {q:"How many seats are in the Assam Legislative Assembly?",a:["126","140","100","147"],correct:0,topic:"Polity"},
                {q:"The Sixth Schedule of the Constitution deals with?",a:["Tribal areas in Northeast","Emergency provisions","Fundamental rights","Directive principles"],correct:0,topic:"Polity"},
                {q:"Which is the largest autonomous council in Assam?",a:["Bodoland Territorial Region","Karbi Anglong","Dima Hasao","Mikir Hills"],correct:0,topic:"Polity"},
                {q:"Who was the first Governor of Assam?",a:["Sir Akbar Hydari","Sir William Reid","Sir Robert Neil Reid","Sir Andrew Clow"],correct:0,topic:"Polity"}
            ],
            hard: [
                {q:"Under which amendment was Article 371B added?",a:["22nd Amendment","42nd Amendment","44th Amendment","52nd Amendment"],correct:0,topic:"Polity"},
                {q:"The Inner Line Permit (ILP) system is regulated under which act?",a:["Bengal Eastern Frontier Regulation 1873","Assam Frontier Act","ILP Act 2019","Bodoland Agreement"],correct:0,topic:"Polity"},
                {q:"CLAUSE 6 of the Assam Accord deals with?",a:["Cultural identity protection","Border security","Economic development","Tea industry reforms"],correct:0,topic:"Polity"},
                {q:"How many Parliamentary constituencies does Assam have?",a:["14","7","21","11"],correct:0,topic:"Polity"}
            ]
        },
        'Geography': {
            easy: [
                {q:"What is the area of Assam (approximately)?",a:["78,438 sq km","85,000 sq km","70,000 sq km","90,000 sq km"],correct:0,topic:"Geography"},
                {q:"Which neighboring country shares the longest border with Assam?",a:["Bangladesh","Bhutan","Myanmar","China"],correct:0,topic:"Geography"},
                {q:"Which is the longest river in Assam?",a:["Brahmaputra","Barak","Subansiri","Dhansiri"],correct:0,topic:"Geography"},
                {q:"Assam shares its border with how many states?",a:["7","5","6","8"],correct:0,topic:"Geography"},
                {q:"Which is the smallest district in Assam by area?",a:["South Salmara-Mankachar","Kamrup Metro","Chirang","Bajali"],correct:0,topic:"Geography"}
            ],
            medium: [
                {q:"The Barak Valley in Assam consists of how many districts?",a:["3","2","4","5"],correct:0,topic:"Geography"},
                {q:"Which is the only hill district in the Brahmaputra Valley?",a:["Dima Hasao","Karbi Anglong","Cachar","East Karbi Anglong"],correct:0,topic:"Geography"},
                {q:"The Bogibeel Bridge connects which two districts?",a:["Dibrugarh and Dhemaji","Jorhat and Majuli","Guwahati and North Guwahati","Tezpur and Sonitpur"],correct:0,topic:"Geography"},
                {q:"Which national park in Assam is a UNESCO World Heritage Site?",a:["Kaziranga","Manas","Nameri","Dibru-Saikhowa"],correct:0,topic:"Geography"},
                {q:"The Brahmaputra is known by what name in Tibet?",a:["Tsangpo","Jamuna","Padma","Siang"],correct:0,topic:"Geography"}
            ],
            hard: [
                {q:"What is the average annual rainfall in Assam?",a:["180-250 cm","100-150 cm","300-400 cm","50-80 cm"],correct:0,topic:"Geography"},
                {q:"The Mikir Hills are now known as?",a:["Karbi Plateau","Nagaon Hills","Dima Hasao","Cachar Hills"],correct:0,topic:"Geography"},
                {q:"Which is the deepest river port on the Brahmaputra?",a:["Pandu Port","Dibrugarh Port","Jogighopa Port","Tezpur Port"],correct:0,topic:"Geography"},
                {q:"The Subansiri is a tributary of which river?",a:["Brahmaputra","Barak","Ganga","Teesta"],correct:0,topic:"Geography"}
            ]
        },
        'Current Affairs': {
            easy: [
                {q:"Who is the current Chief Minister of Assam?",a:["Himanta Biswa Sarma","Sarbananda Sonowal","Tarun Gogoi","Prafulla Kumar Mahanta"],correct:0,topic:"Current Affairs"},
                {q:"ADRE stands for?",a:["Assam Direct Recruitment Examination","Assam District Recruitment Exam","Assam Direct Regional Exam","Assam Divisional Recruitment"],correct:0,topic:"Current Affairs"},
                {q:"Which is the official language of Assam?",a:["Assamese","Bengali","English","Bodo"],correct:0,topic:"Current Affairs"},
                {q:"Assam celebrates Bihu how many times a year?",a:["3","1","2","4"],correct:0,topic:"Current Affairs"},
                {q:"Which sport is most popular in Assam?",a:["Football","Cricket","Hockey","Badminton"],correct:0,topic:"Current Affairs"}
            ],
            medium: [
                {q:"The PM-DevINE scheme is for which region?",a:["Northeast India","North India","South India","East India"],correct:0,topic:"Current Affairs"},
                {q:"What is the name of Assam's first expressway project?",a:["Assam Maa Expressway","Brahmaputra Expressway","Kaziranga Expressway","Saraighat Expressway"],correct:0,topic:"Current Affairs"},
                {q:"Which airport in Assam was declared an international airport?",a:["Lokpriya Gopinath Bordoloi International","Dibrugarh Airport","Silchar Airport","Jorhat Airport"],correct:0,topic:"Current Affairs"},
                {q:"The Asom Mala project is related to?",a:["Road infrastructure","School education","Healthcare","Tea industry"],correct:0,topic:"Current Affairs"},
                {q:"Which scheme provides free admission to girl students in Assam?",a:["Beti Bachao Beti Padhao","Banikanta Kakati Mission","Kanaklata Sabu","Agnigarh Scheme"],correct:0,topic:"Current Affairs"}
            ],
            hard: [
                {q:"The NRC final list for Assam was published in?",a:["August 2019","December 2019","January 2020","August 2018"],correct:0,topic:"Current Affairs"},
                {q:"What is the GDP growth rate target for Assam by 2026?",a:["12%","8%","15%","10%"],correct:0,topic:"Current Affairs"},
                {q:"The Assam Cabinet approved how many new districts in 2023-24?",a:["8","5","3","10"],correct:0,topic:"Current Affairs"},
                {q:"Which scheme offers Rs 10,000 to girl students passing HSLC?",a:["Banikanta Kakati Mission","Beti Bachao","Kanaklata Baruah Fund","Indira Gandhi Scholarship"],correct:0,topic:"Current Affairs"}
            ]
        }
    },
    'APSC': {
        'GK': {
            easy: [
                {q:"APSC stands for?",a:["Assam Public Service Commission","Assam Police Service Commission","Assam Provincial Service Commission","Assam Public Sector Commission"],correct:0,topic:"GK"},
                {q:"APSC headquarters is located in?",a:["Guwahati","Dispur","Jorhat","Dibrugarh"],correct:0,topic:"GK"},
                {q:"The minimum age to appear for APSC CCE is?",a:["21 years","18 years","25 years","20 years"],correct:0,topic:"GK"},
                {q:"APSC conducts which exam for civil services?",a:["Combined Competitive Examination","Civil Services Exam","State Services Exam","Administrative Exam"],correct:0,topic:"GK"},
                {q:"How many attempts are allowed for APSC CCE?",a:["No limit (age dependent)","3","5","6"],correct:0,topic:"GK"}
            ],
            medium: [
                {q:"The APSC CCE Prelims has how many papers?",a:["2","1","3","4"],correct:0,topic:"Polity"},
                {q:"APSC comes under which article of the Constitution?",a:["Article 315","Article 320","Article 312","Article 318"],correct:0,topic:"Polity"},
                {q:"The Mains exam of APSC CCE has how many papers?",a:["8","6","4","5"],correct:0,topic:"Polity"},
                {q:"Who was the first chairman of APSC?",a:["K Anbarasu","Rajiv Bora","Om Prakash","Manoj Choudhury"],correct:0,topic:"GK"},
                {q:"What is the marking scheme of APSC Prelims GS?",a:["200 marks, 2 hours","100 marks, 1 hour","300 marks, 3 hours","150 marks, 2 hours"],correct:0,topic:"Polity"}
            ],
            hard: [
                {q:"What is the maximum age limit for APSC CCE (general)?",a:["38 years","35 years","40 years","32 years"],correct:0,topic:"Polity"},
                {q:"The APSC CCE interview carries how many marks?",a:["275","200","250","300"],correct:0,topic:"Polity"},
                {q:"What is the minimum educational qualification for APSC CCE?",a:["Bachelor's degree","Master's degree","12th pass","Diploma"],correct:0,topic:"Polity"},
                {q:"The APSC CCE Mains optional subject carries how many marks?",a:["400","200","300","500"],correct:0,topic:"Polity"}
            ]
        },
        'History': {
            easy: [
                {q:"The Treaty of Yandaboo was signed between whom?",a:["British and Burma","British and Ahom","British and Koch","Ahom and Mughal"],correct:0,topic:"History"},
                {q:"Who was the first Assamese to write an English book?",a:["Anandaram Dhekial Phukan","Lakshminath Bezbaroa","Gunabhiram Barua","Jyoti Prasad Agarwala"],correct:0,topic:"History"},
                {q:"Which ancient kingdom was in present-day Assam?",a:["Kamarupa","Magadha","Kalinga","Vatsa"],correct:0,topic:"History"},
                {q:"Who was Pushyavarman in Assam history?",a:["Founder of Varman dynasty","Ahom king","Koch ruler","Kachari king"],correct:0,topic:"History"},
                {q:"The term 'Mlechchha' dynasty refers to which kingdom?",a:["Kamarupa","Ahom","Koch","Kachari"],correct:0,topic:"History"}
            ],
            medium: [
                {q:"Hiuen Tsang visited Kamarupa in which century?",a:["7th century","5th century","8th century","6th century"],correct:0,topic:"History"},
                {q:"Who was Bhaskaravarman?",a:["King of Kamarupa","Ahom king","Koch ruler","Mughal general"],correct:0,topic:"History"},
                {q:"The Dhing earthquake occurred in which year?",a:["1897","1950","1947","1934"],correct:0,topic:"History"},
                {q:"Who founded the Arya Samaj movement in Assam?",a:["Swami Dayananda Saraswati","Lakshminath Bezbaroa","Jyoti Prasad Agarwala","Gunabhiram Barua"],correct:0,topic:"History"}
            ],
            hard: [
                {q:"The Kachari kingdom's capital was at?",a:["Dimapur then Maibong","Sivasagar","Guwahati","Tezpur"],correct:0,topic:"History"},
                {q:"Who was the last Koch king?",a:["Parikshit Narayan","Naranarayan","Viswa Singha","Raghudev"],correct:0,topic:"History"},
                {q:"The Chutia kingdom was annexed by which dynasty?",a:["Ahom","Koch","Kachari","British"],correct:0,topic:"History"},
                {q:"When was the Assam Association established?",a:["1903","1911","1921","1894"],correct:0,topic:"History"}
            ]
        }
    }
};
const DEFAULT_QUESTIONS = {
    easy:[
        {q:"What is the capital of Assam?",a:["Dispur","Guwahati","Dibrugarh","Jorhat"],correct:0,topic:"GK"},
        {q:"Which river flows through Assam?",a:["Brahmaputra","Ganga","Yamuna","Godavari"],correct:0,topic:"GK"},
        {q:"What is the official language of Assam?",a:["Assamese","Hindi","Bengali","English"],correct:0,topic:"GK"},
        {q:"Which animal is Assam famous for?",a:["One-horned Rhino","Lion","Tiger","Elephant"],correct:0,topic:"GK"},
        {q:"Which festival is most celebrated in Assam?",a:["Bihu","Durga Puja","Diwali","Holi"],correct:0,topic:"GK"}
    ],
    medium:[
        {q:"The Battle of Saraighat was fought in which year?",a:["1671","1826","1857","1947"],correct:0,topic:"History"},
        {q:"Who was Lachit Borphukan?",a:["Ahom military commander","Koch king","British officer","Freedom fighter"],correct:0,topic:"History"},
        {q:"Majuli is the world's largest what?",a:["River island","Freshwater lake","Tea garden","Forest reserve"],correct:0,topic:"Geography"},
        {q:"Kaziranga National Park is famous for?",a:["One-horned Rhino","Tiger","Elephant","Gibbon"],correct:0,topic:"GK"},
        {q:"Assam produces approximately what percentage of India's tea?",a:["~52%","~33%","~25%","~70%"],correct:0,topic:"Economy"}
    ],
    hard:[
        {q:"The Treaty of Yandaboo was signed in?",a:["1826","1857","1757","1947"],correct:0,topic:"History"},
        {q:"Article 371B provides special provisions for?",a:["Assam","Nagaland","Manipur","Meghalaya"],correct:0,topic:"Polity"},
        {q:"The Assam Accord was signed in?",a:["1985","1979","1990","2000"],correct:0,topic:"Current Affairs"},
        {q:"Who was the first Chief Minister of Assam?",a:["Gopinath Bordoloi","Bishnu Ram Medhi","Tarun Gogoi","Prafulla Mahanta"],correct:0,topic:"History"},
        {q:"The Moamoria Rebellion weakened which dynasty?",a:["Ahom","Koch","Kachari","Chutiya"],correct:0,topic:"History"}
    ]
};

// ── GET QUESTIONS ─────────────────────────────────────────────────────
function getQuestions(exam,category,difficulty,count){
    let pool=[];
    const examData=QUESTION_BANK[exam]||QUESTION_BANK['ADRE'];
    const catData=examData[category]||examData['GK']||DEFAULT_QUESTIONS;
    pool=catData[difficulty]||catData['medium']||DEFAULT_QUESTIONS[difficulty]||DEFAULT_QUESTIONS['medium'];
    if(pool.length<count){
        const extra=DEFAULT_QUESTIONS[difficulty]||DEFAULT_QUESTIONS['medium'];
        pool=[...pool,...extra];
    }
    const shuffled=[...pool].sort(()=>Math.random()-0.5);
    return shuffled.slice(0,Math.min(count,shuffled.length));
}

// ── OPPONENT ANSWER SIMULATION ────────────────────────────────────────
function simulateOpponentAnswer(opponent,question,qi,totalQ,currentScore){
    let baseAcc=parseFloat(opponent.accuracy)/100;
    const diffMod={easy:0.1,medium:0,hard:-0.12}[S.difficulty]||0;
    const topic=question.topic||'GK';
    let topicMod=0;
    if(opponent.strengths&&opponent.strengths.includes(topic))topicMod+=0.15;
    if(opponent.weaknesses&&opponent.weaknesses.includes(topic))topicMod-=0.15;
    const progressMod=-(qi/totalQ)*0.05;
    const streakMod=currentScore>0?Math.min(0.05,currentScore*0.005):0;
    const randF=(Math.random()-0.5)*0.16;
    const correctProb=Math.max(0.15,Math.min(0.95,baseAcc+diffMod+topicMod+progressMod+streakMod+randF));
    const isCorrect=Math.random()<correctProb;
    const baseTime=opponent.response_speed||5;
    const timeVar=(Math.random()-0.5)*4;
    const respTime=Math.max(2,Math.min(28,baseTime*2+timeVar));
    let chosenIndex=question.correct;
    if(!isCorrect){
        const wrongIdx=question.a.map((_,i)=>i).filter(i=>i!==question.correct);
        chosenIndex=wrongIdx[Math.floor(Math.random()*wrongIdx.length)];
    }
    return{chosenIndex,isCorrect,responseTime:Math.round(respTime*1000),score:isCorrect?100+Math.round((30-respTime)/30*30):0};
}

function precomputeOpponentAnswers(opponent,questions){
    const answers=[];let score=0;let correct=0;
    questions.forEach((q,i)=>{
        const ans=simulateOpponentAnswer(opponent,q,i,questions.length,score);
        answers.push(ans);score+=ans.score;if(ans.isCorrect)correct++;
    });
    return{answers,score,correct};
}

// ── DATA LAYER (localStorage + optional Base44 API sync) ─────────────
// Primary: localStorage for instant offline-first persistence
// Optional: Base44 backend for server-authoritative scoring (if app is public)

const ARENA_FN_URL = 'https://lyra-8f08d11f.base44.app/functions/arenaApi';
const LS_KEY_STATS = 'studyria_arena_stats';
const LS_KEY_HISTORY = 'studyria_arena_history';

async function arenaCall(action, params = {}) {
    try {
        const res = await fetch(ARENA_FN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, ...params })
        });
        if (!res.ok) return null;
        return await res.json();
    } catch (e) { return null; }
}

function getCurrentUser() {
    if (window.currentUser && window.currentUser.uid) {
        return { id: window.currentUser.uid, name: window.currentUser.name || 'Player' };
    }
    const cached = localStorage.getItem('studyria_user');
    if (cached) { try { return JSON.parse(cached); } catch(e){} }
    // Generate a stable anonymous ID for guests
    let guestId = localStorage.getItem('studyria_arena_guest_id');
    if (!guestId) {
        guestId = 'guest-' + Math.random().toString(36).substr(2, 12);
        localStorage.setItem('studyria_arena_guest_id', guestId);
    }
    return { id: guestId, name: 'Player' };
}

function lsGet(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch(e) { return fallback; }
}

function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch(e) {}
}

// ── 8 PERMANENT OPPONENTS (static data — persistent profiles) ─────────
const STATIC_OPPONENTS = [
    {id:'opp1',name:'Rituraj Saikia',gender:'male',rating:1080,accuracy:72.5,difficulty_level:'medium',response_speed:3,strengths:['GK','Current Affairs'],weaknesses:['History','Polity'],recent_form:['W','W','L','W','W'],wins:10,losses:8,draws:2,matches:20,current_streak:3,best_streak:5,active:true},
    {id:'opp2',name:'Parthajit Bora',gender:'male',rating:1120,accuracy:81.0,difficulty_level:'hard',response_speed:6,strengths:['Polity','History'],weaknesses:['Geography'],recent_form:['W','L','W','W','W'],wins:12,losses:5,draws:1,matches:18,current_streak:4,best_streak:7,active:true},
    {id:'opp3',name:'Ankur Hazarika',gender:'male',rating:1050,accuracy:75.0,difficulty_level:'medium',response_speed:5,strengths:['History','Geography'],weaknesses:['Math'],recent_form:['L','W','W','L','W'],wins:10,losses:9,draws:2,matches:22,current_streak:1,best_streak:4,active:true},
    {id:'opp4',name:'Debojit Dutta',gender:'male',rating:1150,accuracy:68.0,difficulty_level:'hard',response_speed:2,strengths:['GK','Geography'],weaknesses:['Polity','Science'],recent_form:['W','W','W','L','W'],wins:14,losses:6,draws:1,matches:21,current_streak:3,best_streak:6,active:true},
    {id:'opp5',name:'Junali Saikia',gender:'female',rating:1030,accuracy:74.0,difficulty_level:'medium',response_speed:5,strengths:['Current Affairs','GK'],weaknesses:['Math'],recent_form:['W','L','W','W','L'],wins:9,losses:10,draws:1,matches:20,current_streak:0,best_streak:3,active:true},
    {id:'opp6',name:'Nandita Bora',gender:'female',rating:1100,accuracy:83.0,difficulty_level:'hard',response_speed:7,strengths:['Assam GK','History'],weaknesses:['Geography'],recent_form:['W','W','W','W','W'],wins:13,losses:4,draws:0,matches:17,current_streak:5,best_streak:5,active:true},
    {id:'opp7',name:'Priyanka Hazarika',gender:'female',rating:1060,accuracy:71.0,difficulty_level:'medium',response_speed:3,strengths:['Geography','Science'],weaknesses:['Polity'],recent_form:['L','W','L','W','W'],wins:11,losses:8,draws:2,matches:21,current_streak:2,best_streak:4,active:true},
    {id:'opp8',name:'Mousumi Dutta',gender:'female',rating:1090,accuracy:78.0,difficulty_level:'medium',response_speed:6,strengths:['History','Polity'],weaknesses:['Current Affairs'],recent_form:['W','W','L','W','L'],wins:12,losses:7,draws:1,matches:20,current_streak:0,best_streak:4,active:true}
];

async function loadOpponents(){
    // Try Base44 API first
    const res = await arenaCall('loadOpponents');
    if (res && res.success && res.data && res.data.length > 0) {
        S.opponents = res.data;
    } else {
        // Fallback: use static opponents
        S.opponents = STATIC_OPPONENTS;
    }
    return S.opponents;
}

async function loadUserStats(){
    const user = getCurrentUser();
    if (!user || !user.id) return null;
    
    // Try Base44 API first
    const res = await arenaCall('loadUserStats', { user_id: user.id });
    if (res && res.success && res.data) {
        S.stats = res.data;
        S.rating = res.data.rating || 1000;
        S.currentStreak = res.data.current_streak || 0;
        S.bestStreak = res.data.best_streak || 0;
        S.recentForm = res.data.recent_form || [];
        return S.stats;
    }
    
    // Fallback: localStorage
    const lsStats = lsGet(LS_KEY_STATS, null);
    if (lsStats) {
        S.stats = lsStats;
        S.rating = lsStats.rating || 1000;
        S.currentStreak = lsStats.current_streak || 0;
        S.bestStreak = lsStats.best_streak || 0;
        S.recentForm = lsStats.recent_form || [];
    } else {
        // Initialize new user stats
        S.stats = { user_id: user.id, rating: 1000, matches: 0, wins: 0, losses: 0, draws: 0, current_streak: 0, best_streak: 0, recent_form: [] };
        S.rating = 1000;
        S.currentStreak = 0;
        S.bestStreak = 0;
        S.recentForm = [];
        lsSet(LS_KEY_STATS, S.stats);
    }
    return S.stats;
}

async function loadHistory(){
    const user = getCurrentUser();
    if (!user || !user.id) return [];
    
    // Try Base44 API first
    const res = await arenaCall('loadHistory', { user_id: user.id });
    if (res && res.success && res.data && res.data.length > 0) {
        S.history = res.data;
        return S.history;
    }
    
    // Fallback: localStorage
    S.history = lsGet(LS_KEY_HISTORY, []);
    return S.history;
}

async function loadLeaderboard(){
    // Try Base44 API first
    const res = await arenaCall('loadLeaderboard');
    if (res && res.success && res.data && res.data.length > 0) {
        S.leaderboard = res.data;
        return S.leaderboard;
    }
    
    // Fallback: build from AI opponents + user stats
    const user = getCurrentUser();
    const userStats = S.stats || lsGet(LS_KEY_STATS, null);
    const board = STATIC_OPPONENTS.map(o => ({
        name: o.name, rating: o.rating, matches: o.matches, wins: o.wins, current_streak: o.current_streak, is_ai: true
    }));
    if (userStats) {
        board.push({
            name: (user && user.name) || 'You', rating: userStats.rating || 1000, matches: userStats.matches || 0, wins: userStats.wins || 0, current_streak: userStats.current_streak || 0, is_ai: false, is_you: true
        });
    }
    board.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    S.leaderboard = board;
    return S.leaderboard;
}

// ── ELO RATING (client-side fallback, same formula as server) ────────
function calcElo(userRating, opponentRating, result) {
    const expected = 1 / (1 + Math.pow(10, (opponentRating - userRating) / 400));
    const K = 32;
    const scoreVal = result === 'win' ? 1 : result === 'draw' ? 0.5 : 0;
    const change = Math.round(K * (scoreVal - expected));
    return { change, after: Math.max(100, userRating + change) };
}

// ── SAVE MATCH TO LOCALSTORAGE ───────────────────────────────────────
function saveMatchToLocal(matchData) {
    const history = lsGet(LS_KEY_HISTORY, []);
    history.unshift(matchData);
    lsSet(LS_KEY_HISTORY, history.slice(0, 50));
    S.history = history.slice(0, 50);
}

function saveStatsToLocal(stats) {
    lsSet(LS_KEY_STATS, stats);
    S.stats = stats;
    S.rating = stats.rating || 1000;
    S.currentStreak = stats.current_streak || 0;
    S.bestStreak = stats.best_streak || 0;
    S.recentForm = stats.recent_form || [];
}
// ── MATCHMAKING ──────────────────────────────────────────────────────
async function startMatchmaking(){
    S.page='matchmaking';S.searchSeconds=0;renderMatchmaking();
    if(S.opponents.length===0)await loadOpponents();
    const SEARCH_DURATION=100;
    S.searchInterval=setInterval(()=>{
        S.searchSeconds++;updateMatchmakingUI();
        if(S.searchSeconds>=SEARCH_DURATION){clearInterval(S.searchInterval);selectAIOpponent();}
    },1000);
}

function selectAIOpponent(){
    if(S.opponents.length===0){console.error('[Arena] No opponents');return;}
    const userRating=S.rating||1000;
    const teamSize=getTeamSize(S.mode);
    const isTeamMode=['2v2','3v3','4v4'].includes(S.mode);
    
    if(isTeamMode){
        // Select multiple opponents for team modes
        // Pick opponents closest to user rating first, then fill with random
        const sorted=[...S.opponents].sort((a,b)=>Math.abs(a.rating-userRating)-Math.abs(b.rating-userRating));
        const shuffled=[...S.opponents].sort(()=>Math.random()-0.5);
        // Mix: 50% closest, 50% random for variety
        const pool=[...sorted.slice(0,4),...shuffled.slice(0,4)];
        const unique=[];
        const seen=new Set();
        pool.forEach(o=>{if(!seen.has(o.id)&&unique.length<teamSize){seen.add(o.id);unique.push(o);}});
        // Fill remaining from all opponents if needed
        if(unique.length<teamSize){
            S.opponents.forEach(o=>{if(!seen.has(o.id)&&unique.length<teamSize){seen.add(o.id);unique.push(o);}});
        }
        S.teamOpponents=unique;
        S.matchOpponent=unique[0]; // Primary opponent for display
        showOpponentFound(unique[0],unique);
    }else{
        // 1v1 or free-for-all: select single opponent
        let bestOpp=null;let bestDiff=Infinity;
        if(Math.random()<0.7){
            S.opponents.forEach(opp=>{const diff=Math.abs(opp.rating-userRating);if(diff<bestDiff){bestDiff=diff;bestOpp=opp;}});
        }else{bestOpp=S.opponents[Math.floor(Math.random()*S.opponents.length)];}
        S.matchOpponent=bestOpp;
        S.teamOpponents=null;
        showOpponentFound(bestOpp);
    }
}

function getTeamSize(mode){
    if(mode==='1v1')return 1;if(mode==='2v2')return 2;
    if(mode==='3v3')return 3;if(mode==='4v4')return 4;
    if(mode==='3 Players')return 2;if(mode==='4 Players')return 3;
    if(mode==='5 Players')return 4;return 1;
}

async function createMatch(opponent){
    try{
        const user=getCurrentUser();if(!user||!user.id)return null;
        const matchCode='ARENA-'+Date.now()+'-'+Math.random().toString(36).substr(2,6).toUpperCase();
        const questions=getQuestions(S.exam,S.category,S.difficulty,S.questionCount);
        const oppResults=precomputeOpponentAnswers(opponent,questions);
        // For team modes, compute all team opponents' answers and sum scores
        let teamResults=null;
        if(S.teamOpponents&&S.teamOpponents.length>1){
            teamResults=S.teamOpponents.map(o=>precomputeOpponentAnswers(o,questions));
            // Use the combined score for team total
            const teamScore=teamResults.reduce((s,r)=>s+r.score,0);
            const teamCorrect=teamResults.reduce((s,r)=>s+r.correct,0);
            S.opponentScore=teamScore;S.opponentCorrect=teamCorrect;
            // Use primary opponent's answers for display, but total score
            S.opponentAnswers=oppResults.answers;
        } else {
            S.opponentScore=oppResults.score;S.opponentCorrect=oppResults.correct;
            S.opponentAnswers=oppResults.answers;
        }
        S.matchCode=matchCode;S.questions=questions;S.matchStartTime=Date.now();
        // Try Base44 API first (server-authoritative)
        const res=await arenaCall('createMatch',{
            user_id:user.id,
            match_code:matchCode,mode:S.mode,
            question_count:S.questionCount,exam_type:S.exam,category:S.category,difficulty:S.difficulty,
            questions:JSON.stringify(questions),
            opponent_id:opponent.id,opponent_name:opponent.name,
            opponent_score:oppResults.score,opponent_correct:oppResults.correct,
            opponent_answers:JSON.stringify(oppResults.answers.map(a=>({chosenIndex:a.chosenIndex,isCorrect:a.isCorrect,responseTime:a.responseTime,score:a.score}))),
            opponent_rating_before:opponent.rating
        });
        if(res&&res.success&&res.data){
            S.matchId=res.data.id;
        } else {
            // Fallback: generate local match ID
            S.matchId='local-'+Date.now();
        }
        return {id:S.matchId,matchCode};
    }catch(e){console.error('[Arena] Create match failed:',e.message);
        S.matchId='local-'+Date.now();
        return null;
    }
}

async function startBattle(){
    if(!S.matchOpponent)return;
    S.page='battle';S.currentQ=0;S.userAnswers=[];S.userScore=0;S.userCorrect=0;
    await createMatch(S.matchOpponent);
    renderBattle();startQuestionTimer();
}

function startQuestionTimer(){
    S.timeLeft=30;updateTimerUI();
    if(S.timer)clearInterval(S.timer);
    S.timer=setInterval(()=>{
        S.timeLeft--;updateTimerUI();
        if(S.timeLeft<=0){clearInterval(S.timer);submitAnswer(-1,true);}
    },1000);
}

async function submitAnswer(selectedIndex,isTimeout){
    if(S.timer)clearInterval(S.timer);
    const question=S.questions[S.currentQ];
    const isCorrect=!isTimeout&&selectedIndex===question.correct;
    let score=0;
    if(isCorrect)score=100+Math.round((S.timeLeft/30)*30);
    S.userScore+=score;if(isCorrect)S.userCorrect++;
    S.userAnswers.push({chosenIndex:selectedIndex,isCorrect,responseTime:(30-S.timeLeft)*1000,score});
    if(S.soundEnabled)playSound(isCorrect?'correct':'wrong');
    showAnswerFeedback(isCorrect,question.correct,selectedIndex);
    setTimeout(()=>{
        S.currentQ++;
        if(S.currentQ<S.questions.length){renderQuestion();startQuestionTimer();}
        else finishBattle();
    },1500);
}

async function finishBattle(){
    if(S.timer)clearInterval(S.timer);
    S.page='result';
    const duration=Math.round((Date.now()-S.matchStartTime)/1000);
    const user=getCurrentUser();
    const matchResult=S.userScore>S.opponentScore?'win':S.userScore<S.opponentScore?'loss':'draw';
    let result={
        result:matchResult,
        rating_before:S.rating,rating_after:S.rating,rating_change:0,
        user_score:S.userScore,opponent_score:S.opponentScore,
        user_correct:S.userCorrect,opponent_correct:S.opponentCorrect,
        opponent_name:S.matchOpponent?S.matchOpponent.name:'Unknown'
    };
    // Try Base44 API first (server-authoritative scoring)
    if(user&&S.matchId&&S.matchId.indexOf('local-')!==0){
        const res=await arenaCall('finalizeMatch',{
            user_id:user.id,
            match_id:S.matchId,user_score:S.userScore,user_correct:S.userCorrect,
            user_answers:JSON.stringify(S.userAnswers),duration:duration
        });
        if(res&&res.success){
            result=Object.assign(result,res);
        }
    }
    // If API didn't provide rating, calculate locally (same Elo formula)
    if(result.rating_change===0){
        const elo=calcElo(S.rating,S.matchOpponent?S.matchOpponent.rating:1000,matchResult);
        result.rating_before=S.rating;
        result.rating_after=elo.after;
        result.rating_change=elo.change;
    }
    // Update local stats
    S.rating=result.rating_after||S.rating;
    if(result.result==='win')S.currentStreak++;else if(result.result==='loss')S.currentStreak=0;
    S.bestStreak=Math.max(S.bestStreak,S.currentStreak);
    const formLetter=result.result==='win'?'W':result.result==='loss'?'L':'D';
    S.recentForm=[...S.recentForm,formLetter].slice(-10);
    // Save to localStorage
    const stats=lsGet(LS_KEY_STATS,{user_id:user?user.id:null,rating:1000,matches:0,wins:0,losses:0,draws:0,current_streak:0,best_streak:0,recent_form:[]});
    stats.rating=result.rating_after;
    stats.matches=(stats.matches||0)+1;
    if(result.result==='win')stats.wins=(stats.wins||0)+1;
    else if(result.result==='loss')stats.losses=(stats.losses||0)+1;
    else stats.draws=(stats.draws||0)+1;
    stats.current_streak=S.currentStreak;
    stats.best_streak=S.bestStreak;
    stats.recent_form=S.recentForm;
    saveStatsToLocal(stats);
    // Save match to history
    saveMatchToLocal({
        match_code:S.matchCode,mode:S.mode,result:result.result,
        user_score:S.userScore,opponent_score:S.opponentScore,
        user_correct:S.userCorrect,opponent_correct:S.opponentCorrect,
        opponent_name:S.matchOpponent?S.matchOpponent.name:'Unknown',
        rating_before:result.rating_before,rating_after:result.rating_after,rating_change:result.rating_change,
        exam_type:S.exam,category:S.category,difficulty:S.difficulty,
        question_count:S.questionCount,duration_seconds:duration,
        created_date:new Date().toISOString()
    });
    renderResult(result);
    loadLeaderboard();
}

// ── SOUND ─────────────────────────────────────────────────────────────
function playSound(type){
    if(!S.soundEnabled)return;
    try{
        const ctx=new(window.AudioContext||window.webkitAudioContext)();
        const osc=ctx.createOscillator();const gain=ctx.createGain();
        osc.connect(gain);gain.connect(ctx.destination);
        if(type==='correct'){osc.frequency.setValueAtTime(800,ctx.currentTime);osc.frequency.setValueAtTime(1200,ctx.currentTime+0.1);gain.gain.setValueAtTime(0.15,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.3);}
        else if(type==='wrong'){osc.frequency.setValueAtTime(200,ctx.currentTime);gain.gain.setValueAtTime(0.15,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.3);}
        else if(type==='victory'){osc.frequency.setValueAtTime(523,ctx.currentTime);osc.frequency.setValueAtTime(659,ctx.currentTime+0.15);osc.frequency.setValueAtTime(784,ctx.currentTime+0.3);gain.gain.setValueAtTime(0.2,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.6);}
        else if(type==='defeat'){osc.frequency.setValueAtTime(400,ctx.currentTime);osc.frequency.setValueAtTime(300,ctx.currentTime+0.2);osc.frequency.setValueAtTime(200,ctx.currentTime+0.4);gain.gain.setValueAtTime(0.2,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.6);}
        else if(type==='tick'){osc.frequency.setValueAtTime(1000,ctx.currentTime);gain.gain.setValueAtTime(0.05,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.1);}
        osc.start(ctx.currentTime);osc.stop(ctx.currentTime+1);
    }catch(e){}
}

// ── RENDER FUNCTIONS ──────────────────────────────────────────────────
function render(){
    const c=document.getElementById('arena-root');if(!c)return;
    switch(S.page){
        case'lobby':renderLobby(c);break;
        case'matchmaking':renderMatchmaking();break;
        case'battle':renderBattle();break;
        case'history':renderHistory(c);break;
        case'leaderboard':renderLeaderboard(c);break;
    }
}


function renderRecentForm(form){
    if(!form||form.length===0)return '';
    var badges=form.map(function(r){
        var color=r==='W'?'var(--success)':r==='L'?'var(--danger)':'var(--text2)';
        return '<span style="width:28px;height:28px;border-radius:6px;background:'+color+';color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.75rem">'+r+'</span>';
    }).join('');
    return '<div style="margin-bottom:24px;background:var(--glass);border:1px solid var(--glass-border);border-radius:var(--radius);padding:16px">'+
        '<div style="font-size:.8rem;color:var(--text2);margin-bottom:8px">📊 RECENT FORM</div>'+
        '<div style="display:flex;gap:6px">'+badges+'</div></div>';
}

function renderLobby(c){
    c.innerHTML=`<div style="padding:16px;max-width:800px;margin:0 auto">
        <div style="text-align:center;margin-bottom:24px">
            <div style="font-size:2.5rem;font-weight:800;background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent">⚔️ Studyria Arena</div>
            <div style="color:var(--text2);font-size:.9rem;margin-top:4px">Compete. Learn. Conquer.</div>
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px">
            <div style="flex:1;min-width:100px;background:var(--glass);border:1px solid var(--glass-border);border-radius:var(--radius);padding:16px;text-align:center">
                <div style="font-size:1.8rem;font-weight:800;color:var(--accent)">${S.rating||1000}</div>
                <div style="font-size:.7rem;color:var(--text2);margin-top:2px">ARENA RATING</div>
            </div>
            <div style="flex:1;min-width:100px;background:var(--glass);border:1px solid var(--glass-border);border-radius:var(--radius);padding:16px;text-align:center">
                <div style="font-size:1.8rem;font-weight:800;color:var(--success)">${S.currentStreak||0}</div>
                <div style="font-size:.7rem;color:var(--text2);margin-top:2px">🔥 WIN STREAK</div>
            </div>
            <div style="flex:1;min-width:100px;background:var(--glass);border:1px solid var(--glass-border);border-radius:var(--radius);padding:16px;text-align:center">
                <div style="font-size:1.8rem;font-weight:800;color:var(--gold)">${S.bestStreak||0}</div>
                <div style="font-size:.7rem;color:var(--text2);margin-top:2px">🏆 BEST STREAK</div>
            </div>
            <div style="flex:1;min-width:100px;background:var(--glass);border:1px solid var(--glass-border);border-radius:var(--radius);padding:16px;text-align:center">
                <div style="font-size:1.8rem;font-weight:800;color:var(--text)">${S.stats?S.stats.matches:0}</div>
                <div style="font-size:.7rem;color:var(--text2);margin-top:2px">TOTAL MATCHES</div>
            </div>
        </div>
        ${renderRecentForm(S.recentForm)}
        <div style="background:var(--glass);border:1px solid var(--glass-border);border-radius:var(--radius);padding:24px;margin-bottom:16px">
            <div style="font-size:1.1rem;font-weight:700;margin-bottom:16px">🎮 Battle Setup</div>
            <div style="margin-bottom:16px">
                <div style="font-size:.8rem;color:var(--text2);margin-bottom:8px">SELECT MODE</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                    ${['1v1','2v2','3v3','4v4','3 Players','4 Players','5 Players'].map(m=>`<button onclick="ARENA.selectMode('${m}')" style="padding:8px 16px;border-radius:var(--radius-sm);border:1px solid var(--glass-border);background:${S.mode===m?'var(--accent)':'var(--bg2)'};color:${S.mode===m?'#fff':'var(--text)'};font-weight:600;cursor:pointer;transition:all .2s">${m}</button>`).join('')}
                </div>
            </div>
            <div style="margin-bottom:16px">
                <div style="font-size:.8rem;color:var(--text2);margin-bottom:8px">EXAM</div>
                <select onchange="ARENA.selectExam(this.value)" style="width:100%;padding:10px;border-radius:var(--radius-sm);border:1px solid var(--glass-border);background:var(--bg2);color:var(--text);font-size:.9rem">
                    <option value="ADRE" ${S.exam==='ADRE'?'selected':''}>ADRE</option>
                    <option value="APSC" ${S.exam==='APSC'?'selected':''}>APSC CCE</option>
                </select>
            </div>
            <div style="margin-bottom:16px">
                <div style="font-size:.8rem;color:var(--text2);margin-bottom:8px">CATEGORY</div>
                <select onchange="ARENA.selectCategory(this.value)" style="width:100%;padding:10px;border-radius:var(--radius-sm);border:1px solid var(--glass-border);background:var(--bg2);color:var(--text);font-size:.9rem">
                    ${['GK','History','Polity','Geography','Current Affairs'].map(c=>`<option value="${c}" ${S.category===c?'selected':''}>${c}</option>`).join('')}
                </select>
            </div>
            <div style="margin-bottom:16px">
                <div style="font-size:.8rem;color:var(--text2);margin-bottom:8px">DIFFICULTY</div>
                <div style="display:flex;gap:8px">
                    ${['easy','medium','hard'].map(d=>`<button onclick="ARENA.selectDifficulty('${d}')" style="flex:1;padding:10px;border-radius:var(--radius-sm);border:1px solid var(--glass-border);background:${S.difficulty===d?'var(--accent)':'var(--bg2)'};color:${S.difficulty===d?'#fff':'var(--text)'};font-weight:600;cursor:pointer;text-transform:capitalize">${d}</button>`).join('')}
                </div>
            </div>
            <div style="margin-bottom:20px">
                <div style="font-size:.8rem;color:var(--text2);margin-bottom:8px">QUESTIONS</div>
                <div style="display:flex;gap:8px">
                    ${[5,10,15,20].map(c=>`<button onclick="ARENA.selectCount(${c})" style="flex:1;padding:10px;border-radius:var(--radius-sm);border:1px solid var(--glass-border);background:${S.questionCount===c?'var(--accent)':'var(--bg2)'};color:${S.questionCount===c?'#fff':'var(--text)'};font-weight:600;cursor:pointer">${c}</button>`).join('')}
                </div>
            </div>
            <button onclick="ARENA.startMatchmaking()" style="width:100%;padding:14px;border-radius:var(--radius);border:none;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;font-size:1.1rem;font-weight:700;cursor:pointer">⚔️ Find Opponent</button>
        </div>
        <div style="display:flex;gap:12px;margin-bottom:16px">
            <button onclick="ARENA.showHistory()" style="flex:1;padding:12px;border-radius:var(--radius);border:1px solid var(--glass-border);background:var(--glass);color:var(--text);font-weight:600;cursor:pointer">📜 Battle History</button>
            <button onclick="ARENA.showLeaderboard()" style="flex:1;padding:12px;border-radius:var(--radius);border:1px solid var(--glass-border);background:var(--glass);color:var(--text);font-weight:600;cursor:pointer">🏆 Leaderboard</button>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;background:var(--glass);border:1px solid var(--glass-border);border-radius:var(--radius);padding:12px 16px">
            <span style="font-size:.85rem;color:var(--text2)">🔊 Sound Effects</span>
            <label style="position:relative;width:44px;height:24px;cursor:pointer">
                <input type="checkbox" ${S.soundEnabled?'checked':''} onchange="ARENA.toggleSound(this.checked)" style="position:absolute;opacity:0;width:100%;height:100%;cursor:pointer">
                <span style="position:absolute;inset:0;border-radius:12px;background:${S.soundEnabled?'var(--accent)':'var(--glass-border)'};transition:background .2s">
                    <span style="position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .2s;transform:translateX(${S.soundEnabled?'20px':'0'})"></span>
                </span>
            </label>
        </div>
    </div>`;
}

function renderMatchmaking(){
    const c=document.getElementById('arena-root');if(!c)return;
    c.innerHTML=`<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;padding:24px">
        <div style="font-size:3rem;margin-bottom:16px">⚔️</div>
        <div style="font-size:1.5rem;font-weight:700;margin-bottom:8px">Finding Opponent</div>
        <div style="color:var(--text2);font-size:.9rem;margin-bottom:24px">Searching Arena players...</div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;justify-content:center;margin-bottom:24px">
            <div style="background:var(--glass);border:1px solid var(--glass-border);border-radius:var(--radius);padding:16px 24px;text-align:center;min-width:120px">
                <div style="font-size:1.5rem;font-weight:800;color:var(--accent)" id="mm-time">00:00</div>
                <div style="font-size:.7rem;color:var(--text2);margin-top:4px">SEARCH TIME</div>
            </div>
            <div style="background:var(--glass);border:1px solid var(--glass-border);border-radius:var(--radius);padding:16px 24px;text-align:center;min-width:120px">
                <div style="font-size:1.5rem;font-weight:800;color:var(--success)" id="mm-online">${Math.floor(Math.random()*50)+10}</div>
                <div style="font-size:.7rem;color:var(--text2);margin-top:4px">PLAYERS ONLINE</div>
            </div>
            <div style="background:var(--glass);border:1px solid var(--glass-border);border-radius:var(--radius);padding:16px 24px;text-align:center;min-width:120px">
                <div style="font-size:1.5rem;font-weight:800;color:var(--gold)" id="mm-quality">Searching</div>
                <div style="font-size:.7rem;color:var(--text2);margin-top:4px">MATCH QUALITY</div>
            </div>
            <div style="background:var(--glass);border:1px solid var(--glass-border);border-radius:var(--radius);padding:16px 24px;text-align:center;min-width:120px">
                <div style="font-size:1.5rem;font-weight:800;color:var(--text2)" id="mm-eta">~100s</div>
                <div style="font-size:.7rem;color:var(--text2);margin-top:4px">EST. WAIT</div>
            </div>
        </div>
        <div style="width:200px;height:4px;background:var(--glass-border);border-radius:2px;overflow:hidden;margin-bottom:24px">
            <div id="mm-progress" style="height:100%;width:0%;background:linear-gradient(90deg,var(--accent),var(--accent2));transition:width 1s"></div>
        </div>
        <button onclick="ARENA.cancelMatchmaking()" style="padding:10px 24px;border-radius:var(--radius);border:1px solid var(--glass-border);background:var(--glass);color:var(--text2);cursor:pointer;font-weight:600">Cancel</button>
    </div>`;
}

function updateMatchmakingUI(){
    const t=document.getElementById('mm-time');if(!t)return;
    const m=Math.floor(S.searchSeconds/60);const s=S.searchSeconds%60;
    t.textContent=String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
    const p=document.getElementById('mm-progress');if(p)p.style.width=(S.searchSeconds/100)*100+'%';
    const eta=document.getElementById('mm-eta');if(eta)eta.textContent='~'+(100-S.searchSeconds)+'s';
    const q=document.getElementById('mm-quality');
    if(q){if(S.searchSeconds<30)q.textContent='Excellent';else if(S.searchSeconds<60)q.textContent='Good';else if(S.searchSeconds<90)q.textContent='Searching';else q.textContent='Expanding...';}
    if(S.searchSeconds%10===0&&S.soundEnabled)playSound('tick');
}

function showOpponentFound(opponent,teamMembers){
    const c=document.getElementById('arena-root');if(!c)return;
    const formDisplay=(opponent.recent_form&&opponent.recent_form.length>0)
        ?opponent.recent_form.slice(-5).map(r=>`<span style="width:28px;height:28px;border-radius:6px;background:${r==='W'?'var(--success)':r==='L'?'var(--danger)':'var(--text2)'};color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:.75rem">${r}</span>`).join('')
        :'<span style="color:var(--text2);font-size:.8rem">New to Arena</span>';
    
    // Show team members for team modes
    let teamHTML='';
    if(teamMembers&&teamMembers.length>1){
        const teamSize=getTeamSize(S.mode);
        teamHTML='<div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--glass-border)">'+
            '<div style="font-size:.7rem;color:var(--text2);margin-bottom:8px">TEAM OPPONENTS</div>'+
            '<div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center">'+
            teamMembers.map(o=>`<div style="display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:var(--radius-sm);background:var(--bg2)"><div style="width:24px;height:24px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:700">${o.name.charAt(0)}</div><span style="font-size:.8rem">${o.name}</span></div>`).join('')+
            '</div></div>';
    }
    
    c.innerHTML=`<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;padding:24px">
        <div style="font-size:1.5rem;font-weight:700;color:var(--success);margin-bottom:24px">⚔️ OPPONENT FOUND</div>
        <div style="background:var(--glass);border:2px solid var(--accent);border-radius:var(--radius);padding:32px;text-align:center;max-width:400px;width:100%">
            <div style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-size:2rem;font-weight:800;color:#fff;margin:0 auto 16px">${opponent.name.charAt(0)}</div>
            <div style="font-size:1.3rem;font-weight:700;margin-bottom:8px">${opponent.name}</div>
            <div style="display:flex;justify-content:center;gap:16px;margin-bottom:16px">
                <div><div style="font-size:1.1rem;font-weight:700;color:var(--accent)">${opponent.rating}</div><div style="font-size:.7rem;color:var(--text2)">RATING</div></div>
                <div><div style="font-size:1.1rem;font-weight:700;color:var(--gold)">${opponent.accuracy}%</div><div style="font-size:.7rem;color:var(--text2)">ACCURACY</div></div>
            </div>
            <div style="display:flex;justify-content:center;gap:4px;margin-bottom:8px">${formDisplay}</div>
            <div style="font-size:.7rem;color:var(--text2)">RECENT FORM</div>
            ${teamHTML}
        </div>
        <div id="countdown" style="font-size:5rem;font-weight:800;color:var(--accent);margin:32px 0">3</div>
    </div>`;
    let count=3;if(S.soundEnabled)playSound('tick');
    const ci=setInterval(()=>{
        count--;const el=document.getElementById('countdown');
        if(!el){clearInterval(ci);return;}
        if(count>0){el.textContent=count;if(S.soundEnabled)playSound('tick');}
        else if(count===0){el.textContent='BATTLE!';el.style.fontSize='3rem';el.style.color='var(--success)';if(S.soundEnabled)playSound('victory');}
        else{clearInterval(ci);startBattle();}
    },1000);
}

function renderBattle(){renderQuestion();}
function renderQuestion(){
    const c=document.getElementById('arena-root');if(!c)return;
    const q=S.questions[S.currentQ];
    const progress=(S.currentQ/S.questions.length)*100;
    const oppScoreSoFar=S.opponentAnswers.slice(0,S.currentQ).reduce((s,a)=>s+a.score,0);
    c.innerHTML=`<div style="padding:16px;max-width:700px;margin:0 auto">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <div style="text-align:center;flex:1"><div style="font-size:.7rem;color:var(--text2)">YOU</div><div style="font-size:1.3rem;font-weight:800;color:var(--accent)">${S.userScore}</div></div>
            <div style="font-size:1.5rem;font-weight:800;color:var(--text2)">VS</div>
            <div style="text-align:center;flex:1"><div style="font-size:.7rem;color:var(--text2)">${S.matchOpponent?S.matchOpponent.name:'OPPONENT'}</div><div style="font-size:1.3rem;font-weight:800;color:var(--danger)">${S.opponentScore-oppScoreSoFar}</div></div>
        </div>
        <div style="height:4px;background:var(--glass-border);border-radius:2px;overflow:hidden;margin-bottom:8px"><div style="height:100%;width:${progress}%;background:linear-gradient(90deg,var(--accent),var(--accent2));transition:width .3s"></div></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:16px"><span style="font-size:.75rem;color:var(--text2)">Question ${S.currentQ+1} of ${S.questions.length}</span><span style="font-size:.75rem;color:var(--text2)">Score: ${S.userScore}</span></div>
        <div style="text-align:center;margin-bottom:20px"><div id="timer-display" style="display:inline-block;padding:8px 24px;border-radius:var(--radius);background:${S.timeLeft<=10?'var(--danger)':'var(--glass)'};color:${S.timeLeft<=10?'#fff':'var(--text)'};font-size:1.5rem;font-weight:800;min-width:80px;transition:all .3s">${S.timeLeft}s</div></div>
        <div style="background:var(--glass);border:1px solid var(--glass-border);border-radius:var(--radius);padding:24px;margin-bottom:16px"><div style="font-size:1.1rem;font-weight:600;line-height:1.5">${q.q}</div></div>
        <div style="display:flex;flex-direction:column;gap:10px">
            ${q.a.map((opt,i)=>`<button onclick="ARENA.answer(${i})" id="opt-${i}" style="padding:16px;border-radius:var(--radius-sm);border:1px solid var(--glass-border);background:var(--bg2);color:var(--text);font-size:.95rem;text-align:left;cursor:pointer;transition:all .2s"><span style="display:inline-block;width:28px;height:28px;border-radius:50%;background:var(--bg3);text-align:center;line-height:28px;font-weight:700;margin-right:12px">${String.fromCharCode(65+i)}</span>${opt}</button>`).join('')}
        </div>
        <div id="answer-feedback" style="display:none;margin-top:16px;padding:16px;border-radius:var(--radius);text-align:center"></div>
    </div>`;
}

function updateTimerUI(){
    const el=document.getElementById('timer-display');if(!el)return;
    el.textContent=S.timeLeft+'s';
    if(S.timeLeft<=10){el.style.background='var(--danger)';el.style.color='#fff';}
}

function showAnswerFeedback(isCorrect,correctIndex,selectedIndex){
    S.questions[S.currentQ].a.forEach((_,i)=>{
        const btn=document.getElementById('opt-'+i);if(!btn)return;
        btn.disabled=true;btn.style.cursor='default';
        if(i===correctIndex){btn.style.background='var(--success)';btn.style.color='#fff';btn.style.borderColor='var(--success)';}
        else if(i===selectedIndex&&!isCorrect){btn.style.background='var(--danger)';btn.style.color='#fff';btn.style.borderColor='var(--danger)';}
    });
    const fb=document.getElementById('answer-feedback');
    if(fb){fb.style.display='block';fb.style.background=isCorrect?'rgba(16,217,142,0.15)':'rgba(255,77,109,0.15)';fb.style.color=isCorrect?'var(--success)':'var(--danger)';
    fb.innerHTML=isCorrect?`<div style="font-size:1.2rem;font-weight:700">✅ Correct! +${100+Math.round((S.timeLeft/30)*30)} pts</div>`:`<div style="font-size:1.2rem;font-weight:700">❌ Wrong! Answer: ${String.fromCharCode(65+correctIndex)}</div>`;}
}

function renderResult(result){
    const c=document.getElementById('arena-root');if(!c)return;
    const isWin=result.result==='win';const isDraw=result.result==='draw';
    const title=isWin?'🏆 VICTORY':isDraw?'🤝 DRAW':'💀 DEFEAT';
    const titleColor=isWin?'var(--success)':isDraw?'var(--gold)':'var(--danger)';
    if(isWin&&S.soundEnabled)playSound('victory');else if(!isWin&&!isDraw&&S.soundEnabled)playSound('defeat');
    c.innerHTML=`<div style="padding:16px;max-width:600px;margin:0 auto;text-align:center">
        <div style="font-size:2rem;font-weight:800;color:${titleColor};margin:24px 0">${title}</div>
        <div style="display:flex;justify-content:space-around;align-items:flex-end;margin-bottom:32px">
            <div><div style="font-size:.8rem;color:var(--text2);margin-bottom:4px">YOU</div><div style="font-size:2.5rem;font-weight:800;color:var(--accent)">${result.user_score}</div></div>
            <div style="font-size:1.5rem;color:var(--text2);padding-bottom:8px">vs</div>
            <div><div style="font-size:.8rem;color:var(--text2);margin-bottom:4px">${S.teamOpponents&&S.teamOpponents.length>1?'TEAM ('+S.teamOpponents.length+')':(result.opponent_name||'OPPONENT')}</div><div style="font-size:2.5rem;font-weight:800;color:var(--danger)">${result.opponent_score}</div></div>
        </div>
        <div style="display:flex;gap:12px;margin-bottom:24px">
            <div style="flex:1;background:var(--glass);border:1px solid var(--glass-border);border-radius:var(--radius);padding:16px">
                <div style="font-size:.7rem;color:var(--text2)">ACCURACY</div><div style="font-size:1.2rem;font-weight:700">${Math.round(result.user_correct/S.questions.length*100)}%</div>
                <div style="font-size:.75rem;color:var(--text2);margin-top:4px">${result.user_correct}/${S.questions.length} correct</div>
            </div>
            <div style="flex:1;background:var(--glass);border:1px solid var(--glass-border);border-radius:var(--radius);padding:16px">
                <div style="font-size:.7rem;color:var(--text2)">OPPONENT</div><div style="font-size:1.2rem;font-weight:700">${Math.round(result.opponent_correct/S.questions.length*100)}%</div>
                <div style="font-size:.75rem;color:var(--text2);margin-top:4px">${result.opponent_correct}/${S.questions.length} correct</div>
            </div>
        </div>
        <div style="background:var(--glass);border:1px solid var(--glass-border);border-radius:var(--radius);padding:16px;margin-bottom:24px">
            <div style="font-size:.8rem;color:var(--text2)">ARENA RATING</div>
            <div style="display:flex;justify-content:center;align-items:center;gap:12px;margin-top:8px">
                <span style="font-size:1.2rem;color:var(--text2)">${result.rating_before}</span><span style="color:var(--text2)">→</span>
                <span style="font-size:1.5rem;font-weight:800;color:${result.rating_change>=0?'var(--success)':'var(--danger)'}">${result.rating_after}</span>
                <span style="font-size:1rem;font-weight:700;color:${result.rating_change>=0?'var(--success)':'var(--danger)'}">${result.rating_change>=0?'+':''}${result.rating_change}</span>
            </div>
        </div>
        <div style="margin-bottom:24px"><span style="font-size:1.1rem">🔥 ${S.currentStreak} Win Streak</span></div>
        <div style="display:flex;flex-direction:column;gap:10px">
            <button onclick="ARENA.reviewMistakes()" style="padding:14px;border-radius:var(--radius);border:1px solid var(--glass-border);background:var(--glass);color:var(--text);font-weight:600;cursor:pointer">📝 Review Mistakes</button>
            <button onclick="ARENA.battleAgain()" style="padding:14px;border-radius:var(--radius);border:1px solid var(--glass-border);background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;font-weight:700;cursor:pointer">⚔️ Battle Again</button>
            <button onclick="ARENA.backToLobby()" style="padding:14px;border-radius:var(--radius);border:1px solid var(--glass-border);background:transparent;color:var(--text2);cursor:pointer">← Back to Lobby</button>
        </div>
    </div>`;
}

function renderHistory(c){
    const h=S.history||[];
    c.innerHTML=`<div style="padding:16px;max-width:800px;margin:0 auto">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px">
            <div style="font-size:1.5rem;font-weight:700">📜 Battle History</div>
            <button onclick="ARENA.backToLobby()" style="padding:8px 16px;border-radius:var(--radius-sm);border:1px solid var(--glass-border);background:var(--glass);color:var(--text);cursor:pointer">← Back</button>
        </div>
        ${h.length===0?`<div style="text-align:center;padding:48px;color:var(--text2)"><div style="font-size:3rem;margin-bottom:8px">🎮</div><div>No battles yet. Start your first Arena battle!</div></div>`:`
            <div style="display:flex;flex-direction:column;gap:10px">
                ${h.map(b=>{const isWin=b.result==='win';const isDraw=b.result==='draw';const color=isWin?'var(--success)':isDraw?'var(--gold)':'var(--danger)';return `
                    <div style="display:flex;align-items:center;gap:16px;background:var(--glass);border:1px solid var(--glass-border);border-radius:var(--radius);padding:14px 16px">
                        <div style="width:48px;height:48px;border-radius:8px;background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.8rem">${isWin?'WIN':isDraw?'DRAW':'LOSS'}</div>
                        <div style="flex:1"><div style="font-weight:600;font-size:.9rem">vs ${b.opponent_name}</div><div style="font-size:.75rem;color:var(--text2)">${b.mode} • ${b.question_count} Q • ${b.exam_type} • ${b.difficulty}</div></div>
                        <div style="text-align:right"><div style="font-weight:700;font-size:.9rem">${b.user_score} - ${b.opponent_score}</div><div style="font-size:.75rem;color:${b.rating_change>=0?'var(--success)':'var(--danger)'}">${b.rating_change>=0?'+':''}${b.rating_change} rating</div></div>
                    </div>`;}).join('')}
            </div>`}
    </div>`;
}

function renderLeaderboard(c){
    const b=S.leaderboard||[];
    c.innerHTML=`<div style="padding:16px;max-width:800px;margin:0 auto">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px">
            <div style="font-size:1.5rem;font-weight:700">🏆 Arena Leaderboard</div>
            <button onclick="ARENA.backToLobby()" style="padding:8px 16px;border-radius:var(--radius-sm);border:1px solid var(--glass-border);background:var(--glass);color:var(--text);cursor:pointer">← Back</button>
        </div>
        ${b.length===0?`<div style="text-align:center;padding:48px;color:var(--text2)"><div style="font-size:3rem;margin-bottom:8px">🏆</div><div>No ranked players yet. Be the first!</div></div>`:`
            <div style="display:flex;flex-direction:column;gap:8px">
                ${b.slice(0,50).map((p,i)=>{const medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':'';return `
                    <div style="display:flex;align-items:center;gap:16px;background:var(--glass);border:1px solid var(--glass-border);border-radius:var(--radius);padding:12px 16px">
                        <div style="width:32px;text-align:center;font-weight:800;color:${i<3?'var(--gold)':'var(--text2)'}">${medal||i+1}</div>
                        <div style="flex:1"><div style="font-weight:600">${p.is_you?'⭐ '+p.name:p.name||'Player'}</div><div style="font-size:.75rem;color:var(--text2)">${p.wins||0}W ${p.losses||0}L ${p.draws||0}D • 🔥 ${p.current_streak||0}</div></div>
                        <div style="text-align:right"><div style="font-weight:800;color:var(--accent)">${p.rating}</div><div style="font-size:.7rem;color:var(--text2)">RATING</div></div>
                    </div>`;}).join('')}
            </div>`}
    </div>`;
}

function reviewMistakes(){
    const c=document.getElementById('arena-root');if(!c)return;
    const wrong=S.userAnswers.map((a,i)=>({...a,question:S.questions[i]})).filter(a=>!a.isCorrect);
    const weakest=getWeakestTopic(wrong);
    c.innerHTML=`<div style="padding:16px;max-width:700px;margin:0 auto">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px">
            <div style="font-size:1.5rem;font-weight:700">📝 Review Mistakes</div>
            <button onclick="ARENA.backToLobby()" style="padding:8px 16px;border-radius:var(--radius-sm);border:1px solid var(--glass-border);background:var(--glass);color:var(--text);cursor:pointer">← Back</button>
        </div>
        ${wrong.length===0?`<div style="text-align:center;padding:48px;color:var(--success)"><div style="font-size:3rem;margin-bottom:8px">🎉</div><div>Perfect! No mistakes this battle!</div></div>`:`
            <div style="display:flex;flex-direction:column;gap:16px">
                ${wrong.map(w=>`<div style="background:var(--glass);border:1px solid var(--glass-border);border-radius:var(--radius);padding:16px">
                    <div style="font-weight:600;margin-bottom:12px">${w.question.q}</div>
                    <div style="display:flex;flex-direction:column;gap:6px">
                        ${w.question.a.map((opt,i)=>{let bg='var(--bg2)';let color='var(--text)';let label='';if(i===w.question.correct){bg='rgba(16,217,142,0.2)';color='var(--success)';label=' ✓';}if(i===w.chosenIndex&&!w.isCorrect){bg='rgba(255,77,109,0.2)';color='var(--danger)';label=' ✗';}return `<div style="padding:10px;border-radius:var(--radius-sm);background:${bg};color:${color};font-size:.85rem">${String.fromCharCode(65+i)}. ${opt}${label}</div>`;}).join('')}
                    </div>
                    <div style="margin-top:8px;font-size:.75rem;color:var(--text2)">Topic: ${w.question.topic||'General'}</div>
                </div>`).join('')}
            </div>
            <div style="margin-top:24px;background:var(--glass);border:1px solid var(--glass-border);border-radius:var(--radius);padding:20px;text-align:center">
                <div style="font-size:1.1rem;font-weight:700;margin-bottom:8px">🎯 Weak Area Detected</div>
                <div style="color:var(--text2);font-size:.85rem;margin-bottom:16px">${weakest} needs improvement</div>
                <button onclick="ARENA.backToLobby()" style="padding:12px 24px;border-radius:var(--radius);border:none;background:var(--accent);color:#fff;font-weight:600;cursor:pointer">Practice 10 MCQs</button>
            </div>`}
    </div>`;
}

function getWeakestTopic(wrong){
    const tc={};wrong.forEach(w=>{const t=w.question.topic||'GK';tc[t]=(tc[t]||0)+1;});
    return Object.entries(tc).sort((a,b)=>b[1]-a[1])[0]?.[0]||'GK';
}

// ── PUBLIC API ────────────────────────────────────────────────────────
window.ARENA = {
    init: async function() {
        await Promise.all([loadOpponents(), loadUserStats(), loadHistory(), loadLeaderboard()]);
        // STATIC_OPPONENTS used as fallback in loadOpponents() — no need to duplicate here
        render();
    },
    selectMode: function(m){S.mode=m;render();},
    selectExam: function(e){S.exam=e;},
    selectCategory: function(c){S.category=c;},
    selectDifficulty: function(d){S.difficulty=d;render();},
    selectCount: function(c){S.questionCount=c;render();},
    toggleSound: function(en){S.soundEnabled=en;},
    startMatchmaking: startMatchmaking,
    cancelMatchmaking: function(){if(S.searchInterval)clearInterval(S.searchInterval);S.page='lobby';render();},
    answer: function(index){
        S.questions[S.currentQ].a.forEach((_,i)=>{const btn=document.getElementById('opt-'+i);if(btn)btn.disabled=true;});
        submitAnswer(index,false);
    },
    battleAgain: function(){S.page='lobby';render();setTimeout(()=>startMatchmaking(),300);},
    backToLobby: function(){if(S.timer)clearInterval(S.timer);S.page='lobby';render();},
    showHistory: function(){S.page='history';loadHistory().then(()=>render());},
    showLeaderboard: function(){S.page='leaderboard';loadLeaderboard().then(()=>render());},
    reviewMistakes: reviewMistakes,
    getState: function(){return S;}
};

window.renderArena = function(){
    const c=document.getElementById('arena-root');
    if(c&&window.ARENA)ARENA.init();
};

})();
