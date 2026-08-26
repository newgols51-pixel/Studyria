/* ═══════════════════════════════════════════════════════════════════════
   ADRE EXAM ENGINE — adre-exam.js
   Real exam simulation for ADRE previous-year papers
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

(function () {
  if (!window.ADRE_PAPERS) { console.error('[ADRE] Paper data not loaded'); return; }

  var _state = {
    paper: null,
    questions: [],
    answers: {},
    marked: {},
    currentIdx: 0,
    startTime: 0,
    endTime: 0,
    attemptId: null,
    submitted: false,
    timerInterval: null,
    timeRemaining: 0,
    lastResult: null
  };

  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function fmtTime(s) {
    var h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60);
    return h+':'+(m<10?'0':'')+m+':'+(sec<10?'0':'')+sec;
  }
  function getUserId() {
    if(window.currentUser&&window.currentUser.id)return String(window.currentUser.id);
    if(window.currentUser&&window.currentUser.email)return window.currentUser.email;
    return null;
  }
  function getUserName() {
    if(window.currentUser&&window.currentUser.name)return window.currentUser.name;
    if(window.currentUser&&window.currentUser.email)return window.currentUser.email.split('@')[0];
    return 'Student';
  }

  function getHistory() {
    try { return JSON.parse(localStorage.getItem('adre_history')||'[]'); } catch(e) { return []; }
  }
  function saveHistory(entry) {
    var hist=getHistory();
    hist.unshift(entry);
    if(hist.length>100)hist=hist.slice(0,100);
    try { localStorage.setItem('adre_history',JSON.stringify(hist)); } catch(e) {}
  }

  function renderPaperList(container) {
    if(!container)return;
    var papers=window.ADRE_PAPERS.papers.filter(function(p){return p.published;});
    if(!papers.length){
      container.innerHTML='<div style="text-align:center;padding:40px 20px;color:#888"><div style="font-size:48px;margin-bottom:12px">📋</div><p>No verified ADRE papers available yet.</p></div>';
      return;
    }
    var h='<div class="adre-papers-grid">';
    papers.forEach(function(p){
      var verified=p.verification_status==='VERIFIED_OFFICIAL';
      h+='<div class="adre-paper-card" onclick="ADREExam.startPaper(\''+p.id+'\')">';
      h+='<div class="adre-paper-badge">'+(verified?'✓ Official Paper':'Under Review')+'</div>';
      h+='<div class="adre-paper-title">🏛️ '+esc(p.title)+'</div>';
      h+='<div class="adre-paper-subtitle">'+esc(p.subtitle)+'</div>';
      h+='<div class="adre-paper-meta">';
      h+='<span>📝 '+p.total_questions+' Questions</span>';
      h+='<span>📊 '+p.total_marks+' Marks</span>';
      h+='<span>⏱️ '+(p.duration_minutes/60)+' Hours</span>';
      h+='</div>';
      if(p.negative_marking>0){
        h+='<div class="adre-paper-negative">⚠️ Negative Marking: -'+p.negative_marking+' per wrong answer</div>';
      }
      h+='<div class="adre-paper-verify">'+(verified?'✓ Official Answer Key Verified':'⚠️ Verification Pending')+'</div>';
      h+='<button class="adre-paper-btn">Start Real Paper →</button>';
      h+='</div>';
    });
    h+='</div>';
    var hist=getHistory();
    if(hist.length){
      h+='<div class="adre-history-section"><h3 class="adre-section-title">📊 Your ADRE Attempts</h3>';
      h+='<div class="adre-history-list">';
      hist.slice(0,10).forEach(function(a){
        var pctClass=a.percentage>=60?'good':a.percentage>=40?'avg':'low';
        h+='<div class="adre-history-item" onclick="ADREExam.viewResult(\''+a.attemptId+'\')">';
        h+='<div class="adre-history-left"><div class="adre-history-title">'+esc(a.paperTitle)+'</div>';
        h+='<div class="adre-history-date">'+new Date(a.completedAt).toLocaleDateString([],{month:'short',day:'numeric',year:'numeric'})+' · '+fmtTime(a.timeUsed)+'</div></div>';
        h+='<div class="adre-history-right"><div class="adre-history-score">'+a.finalScore+'/'+a.maxMarks+'</div>';
        h+='<div class="adre-history-pct '+pctClass+'">'+a.percentage+'%</div></div></div>';
      });
      h+='</div></div>';
    }
    container.innerHTML=h;
  }

  function startPaper(paperId) {
    var p=window.ADRE_PAPERS.papers.find(function(x){return x.id===paperId;});
    if(!p||!p.published){alert('This paper is not available.');return;}
    var uid=getUserId();
    if(!uid){if(typeof navigate==='function')navigate('login');return;}
    _state.paper=p;
    _state.questions=p.questions.slice();
    _state.answers={};
    _state.marked={};
    _state.currentIdx=0;
    _state.startTime=Date.now();
    _state.endTime=_state.startTime+p.duration_minutes*60*1000;
    _state.attemptId='adre-'+paperId+'-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);
    _state.submitted=false;
    _state.timeRemaining=p.duration_minutes*60;
    try{
      var saved=JSON.parse(sessionStorage.getItem('adre_active_attempt')||'null');
      if(saved&&saved.attemptId&&saved.paperId===paperId){
        _state.answers=saved.answers||{};
        _state.marked=saved.marked||{};
        _state.currentIdx=saved.currentIdx||0;
        _state.startTime=saved.startTime||_state.startTime;
        _state.endTime=saved.endTime||_state.endTime;
        _state.attemptId=saved.attemptId;
        _state.timeRemaining=Math.max(0,Math.floor((_state.endTime-Date.now())/1000));
      }
    }catch(e){}
    saveAttempt();
    renderExam();
  }

  function saveAttempt() {
    try{
      sessionStorage.setItem('adre_active_attempt',JSON.stringify({
        attemptId:_state.attemptId,paperId:_state.paper.id,
        answers:_state.answers,marked:_state.marked,currentIdx:_state.currentIdx,
        startTime:_state.startTime,endTime:_state.endTime
      }));
    }catch(e){}
  }

  function renderExam() {
    var p=_state.paper,qs=_state.questions,idx=_state.currentIdx,q=qs[idx];
    if(!q)return;
    var page=document.getElementById('page-adre-papers')||document.querySelector('.page.active');
    if(!page)return;
    var answeredCount=Object.keys(_state.answers).length;
    var markedCount=Object.keys(_state.marked).length;
    var unanswered=qs.length-answeredCount;
    var h='<div class="adre-exam-container">';
    h+='<div class="adre-exam-header">';
    h+='<div class="adre-exam-title">🏛️ '+esc(p.title)+'</div>';
    h+='<div class="adre-exam-info">'+esc(p.subtitle)+' · '+p.total_questions+'Q · '+p.total_marks+' Marks</div>';
    h+='<div class="adre-exam-timer" id="adre-timer">⏱ '+fmtTime(_state.timeRemaining)+'</div>';
    h+='</div>';
    h+='<div class="adre-exam-statusbar">';
    h+='<span class="adre-stat-pill answered">✓ '+answeredCount+' Answered</span>';
    h+='<span class="adre-stat-pill unanswered">○ '+unanswered+' Unanswered</span>';
    h+='<span class="adre-stat-pill marked">🚩 '+markedCount+' Marked</span>';
    h+='</div>';
    h+='<div class="adre-exam-body">';
    h+='<div class="adre-palette" id="adre-palette">';
    h+='<div class="adre-palette-title">Question Palette</div>';
    h+='<div class="adre-palette-grid">';
    qs.forEach(function(qq,i){
      var cls='adre-pq';
      if(_state.answers[qq.q_num]!==undefined)cls+=' answered';
      if(_state.marked[qq.q_num])cls+=' marked';
      if(i===idx)cls+=' current';
      h+='<div class="'+cls+'" onclick="ADREExam.gotoQ('+i+')">'+qq.q_num+'</div>';
    });
    h+='</div>';
    h+='<button class="adre-submit-btn" onclick="ADREExam.confirmSubmit()">Submit Exam</button>';
    h+='</div>';
    h+='<div class="adre-question-area">';
    h+='<div class="adre-q-header"><span class="adre-q-num">Question '+q.q_num+' / '+qs.length+'</span>';
    h+='<span class="adre-q-marks">'+q.marks+' mark'+(q.marks>1?'s':'')+' · -'+q.negative_marks+' wrong</span></div>';
    h+='<div class="adre-q-text">'+esc(q.question)+'</div>';
    h+='<div class="adre-q-options">';
    var opts=[{key:'a',text:q.option_a},{key:'b',text:q.option_b},{key:'c',text:q.option_c},{key:'d',text:q.option_d}];
    opts.forEach(function(o){
      if(!o.text)return;
      var selected=_state.answers[q.q_num]===o.key;
      h+='<div class="adre-q-option'+(selected?' selected':'')+'" onclick="ADREExam.selectAnswer('+q.q_num+',\''+o.key+'\')">';
      h+='<span class="adre-opt-letter">'+o.key.toUpperCase()+'</span><span class="adre-opt-text">'+esc(o.text)+'</span></div>';
    });
    h+='</div>';
    h+='<div class="adre-q-actions">';
    h+='<button class="adre-btn-clear" onclick="ADREExam.clearAnswer('+q.q_num+')">Clear Answer</button>';
    h+='<button class="adre-btn-mark" onclick="ADREExam.toggleMark('+q.q_num+')">'+(_state.marked[q.q_num]?'🚩 Unmark':'🚩 Mark for Review')+'</button>';
    h+='</div>';
    h+='<div class="adre-nav">';
    if(idx>0)h+='<button class="adre-nav-btn prev" onclick="ADREExam.gotoQ('+(idx-1)+')">← Previous</button>';
    if(idx<qs.length-1)h+='<button class="adre-nav-btn next" onclick="ADREExam.gotoQ('+(idx+1)+')">Next →</button>';
    else h+='<button class="adre-nav-btn submit" onclick="ADREExam.confirmSubmit()">Submit Exam</button>';
    h+='</div></div></div></div>';
    page.innerHTML=h;
    page.classList.add('active');
    window.scrollTo(0,0);
    startTimer();
  }

  function startTimer() {
    if(_state.timerInterval)clearInterval(_state.timerInterval);
    _state.timerInterval=setInterval(function(){
      if(_state.submitted){clearInterval(_state.timerInterval);return;}
      _state.timeRemaining=Math.max(0,Math.floor((_state.endTime-Date.now())/1000));
      var el=document.getElementById('adre-timer');
      if(el){
        el.textContent='⏱ '+fmtTime(_state.timeRemaining);
        if(_state.timeRemaining<=300)el.classList.add('warning');
        if(_state.timeRemaining<=60)el.classList.add('critical');
      }
      if(_state.timeRemaining<=0){clearInterval(_state.timerInterval);submitExam(true);}
    },1000);
  }

  function selectAnswer(qNum,answer) {
    if(_state.submitted)return;
    _state.answers[qNum]=answer;
    saveAttempt();
    document.querySelectorAll('.adre-q-option').forEach(function(el){
      var letter=el.querySelector('.adre-opt-letter').textContent.toLowerCase();
      el.classList.toggle('selected',letter===answer);
    });
    updatePalette();updateStatusBar();
  }

  function clearAnswer(qNum) {
    if(_state.submitted)return;
    delete _state.answers[qNum];
    saveAttempt();
    renderExam();
  }

  function toggleMark(qNum) {
    if(_state.marked[qNum])delete _state.marked[qNum];
    else _state.marked[qNum]=true;
    saveAttempt();
    updatePalette();updateStatusBar();
  }

  function gotoQ(idx) {
    _state.currentIdx=idx;
    saveAttempt();
    renderExam();
  }

  function updatePalette() {
    _state.questions.forEach(function(qq,i){
      var el=document.querySelector('.adre-pq:nth-child('+(i+1)+')');
      if(!el)return;
      el.classList.toggle('answered',_state.answers[qq.q_num]!==undefined);
      el.classList.toggle('marked',!!_state.marked[qq.q_num]);
      el.classList.toggle('current',i===_state.currentIdx);
    });
  }

  function updateStatusBar() {
    var answered=Object.keys(_state.answers).length;
    var marked=Object.keys(_state.marked).length;
    var unanswered=_state.questions.length-answered;
    var bar=document.querySelector('.adre-exam-statusbar');
    if(bar)bar.innerHTML='<span class="adre-stat-pill answered">✓ '+answered+' Answered</span><span class="adre-stat-pill unanswered">○ '+unanswered+' Unanswered</span><span class="adre-stat-pill marked">🚩 '+marked+' Marked</span>';
  }

  function confirmSubmit() {
    var answered=Object.keys(_state.answers).length;
    var total=_state.questions.length;
    var unanswered=total-answered;
    var msg='Submit your exam?\n\nAnswered: '+answered+'/'+total+'\nUnanswered: '+unanswered;
    if(unanswered>0)msg+='\n\n⚠️ You have '+unanswered+' unanswered questions.';
    if(!confirm(msg))return;
    submitExam(false);
  }

  function submitExam(autoSubmit) {
    if(_state.submitted)return;
    _state.submitted=true;
    if(_state.timerInterval)clearInterval(_state.timerInterval);
    var p=_state.paper,qs=_state.questions;
    var correct=0,wrong=0,unanswered=0,rawScore=0,negMarks=0;
    qs.forEach(function(q){
      var ans=_state.answers[q.q_num];
      if(!ans){unanswered++;return;}
      if(ans===q.correct_answer){correct++;rawScore+=q.marks;}
      else{wrong++;negMarks+=q.negative_marks;}
    });
    var finalScore=Math.max(0,rawScore-negMarks);
    var maxMarks=p.total_marks;
    var percentage=Math.round((finalScore/maxMarks)*10000)/100;
    var accuracy=(correct+wrong)>0?Math.round((correct/(correct+wrong))*100):0;
    var timeUsed=Math.floor((Date.now()-_state.startTime)/1000);
    var timeRemaining=Math.max(0,_state.timeRemaining);
    var result={
      attemptId:_state.attemptId,paperId:p.id,paperTitle:p.title,
      paperCode:p.paper_code,edition:p.edition,year:p.year,level:p.level,
      totalQuestions:qs.length,totalMarks:maxMarks,correct:correct,wrong:wrong,
      unanswered:unanswered,rawScore:rawScore,negativeMarks:negMarks,
      finalScore:finalScore,maxMarks:maxMarks,percentage:percentage,
      accuracy:accuracy,timeUsed:timeUsed,timeRemaining:timeRemaining,
      autoSubmitted:autoSubmit||false,completedAt:new Date().toISOString(),
      userId:getUserId(),userName:getUserName(),answers:_state.answers,
      questions:qs.map(function(q){
        return{q_num:q.q_num,question:q.question,option_a:q.option_a,option_b:q.option_b,
          option_c:q.option_c,option_d:q.option_d,correct_answer:q.correct_answer,
          user_answer:_state.answers[q.q_num]||null,marks:q.marks,
          negative_marks:q.negative_marks,verification_status:q.verification_status};
      })
    };
    saveHistory(result);
    try{sessionStorage.removeItem('adre_active_attempt');}catch(e){}
    renderResult(result);
  }

  function renderResult(r) {
    var page=document.getElementById('page-adre-papers')||document.querySelector('.page.active');
    if(!page)return;
    var isPass=r.percentage>=40;
    var h='<div class="adre-result-container">';
    h+='<div class="adre-result-hero"><div class="adre-result-icon">'+(isPass?'🎉':'💪')+'</div>';
    h+='<div class="adre-result-title">Mock Completed</div>';
    h+='<div class="adre-result-sub">'+esc(r.paperTitle)+'</div>';
    h+='<div class="adre-result-disclaimer">Performance only — not an official recruitment result</div></div>';
    h+='<div class="adre-result-score-box"><div class="adre-result-score-main">'+r.finalScore+' <span class="adre-result-score-max">/ '+r.maxMarks+'</span></div>';
    h+='<div class="adre-result-score-pct">'+r.percentage+'%</div></div>';
    h+='<div class="adre-result-stats">';
    h+='<div class="adre-stat-card correct"><div class="adre-stat-val">'+r.correct+'</div><div class="adre-stat-label">Correct</div></div>';
    h+='<div class="adre-stat-card wrong"><div class="adre-stat-val">'+r.wrong+'</div><div class="adre-stat-label">Wrong</div></div>';
    h+='<div class="adre-stat-card skip"><div class="adre-stat-val">'+r.unanswered+'</div><div class="adre-stat-label">Unanswered</div></div>';
    h+='<div class="adre-stat-card accuracy"><div class="adre-stat-val">'+r.accuracy+'%</div><div class="adre-stat-label">Accuracy</div></div>';
    h+='</div>';
    h+='<div class="adre-result-section"><div class="adre-result-section-title">📊 Score Breakdown</div>';
    h+='<div class="adre-result-row"><span>Raw Score (correct answers)</span><span>+'+r.rawScore+'</span></div>';
    h+='<div class="adre-result-row"><span>Negative Marks (wrong answers)</span><span class="neg">-'+r.negativeMarks+'</span></div>';
    h+='<div class="adre-result-row highlight"><span>Final Score</span><span>'+r.finalScore+' / '+r.maxMarks+'</span></div></div>';
    h+='<div class="adre-result-section"><div class="adre-result-section-title">⏱️ Time Management</div>';
    h+='<div class="adre-result-row"><span>Time Used</span><span>'+fmtTime(r.timeUsed)+'</span></div>';
    h+='<div class="adre-result-row"><span>Time Remaining</span><span>'+fmtTime(r.timeRemaining)+'</span></div>';
    if(r.autoSubmitted)h+='<div class="adre-result-row" style="color:#e57373"><span>⚠️ Auto-submitted (time expired)</span><span></span></div>';
    h+='</div>';
    h+='<div class="adre-result-section"><div class="adre-result-section-title">📝 Question Review</div>';
    r.questions.forEach(function(q){
      var userAns=q.user_answer;
      var isCorrect=userAns===q.correct_answer;
      var isWrong=userAns&&!isCorrect;
      var isSkip=!userAns;
      h+='<div class="adre-review-q'+(isCorrect?' correct':isWrong?' wrong':' skip')+'">';
      h+='<div class="adre-review-q-header"><span class="adre-review-q-num">Q'+q.q_num+'</span>';
      h+='<span class="adre-review-q-status">'+(isCorrect?'✓ Correct':isWrong?'✗ Wrong':'○ Skipped')+'</span>';
      h+='<span class="adre-review-q-marks">'+(isCorrect?'+'+q.marks:isWrong?'-'+q.negative_marks:'0')+'</span></div>';
      h+='<div class="adre-review-q-text">'+esc(q.question)+'</div><div class="adre-review-options">';
      ['a','b','c','d'].forEach(function(key){
        var text=q['option_'+key];if(!text)return;
        var cls='adre-review-opt';
        if(key===q.correct_answer)cls+=' official-correct';
        if(key===userAns&&!isCorrect)cls+=' user-wrong';
        if(key===userAns&&isCorrect)cls+=' user-correct';
        h+='<div class="'+cls+'"><span>'+key.toUpperCase()+'</span> '+esc(text)+'</div>';
      });
      h+='</div><div class="adre-review-verify">'+(q.verification_status==='VERIFIED_OFFICIAL'?'✓ Official Answer Key':'⚠️ '+esc(q.verification_status))+'</div></div>';
    });
    h+='</div>';
    h+='<div class="adre-result-actions">';
    h+='<button class="adre-btn-primary" onclick="ADREExam.retry()">🔄 Retry Exam</button>';
    h+='<button class="adre-btn-secondary" onclick="ADREExam.showCert(\''+r.attemptId+'\')">📜 View Certificate</button>';
    h+='<button class="adre-btn-secondary" onclick="ADREExam.showHome()">← Back to Papers</button>';
    h+='</div></div>';
    page.innerHTML=h;
    window.scrollTo(0,0);
    _state.lastResult=r;
  }

  function showCert(attemptId) {
    var hist=getHistory();
    var r=hist.find(function(a){return a.attemptId===attemptId;})||_state.lastResult;
    if(!r)return;
    var certId='STY-'+r.year+'-P'+r.paperCode+'-'+attemptId.slice(-8).toUpperCase();
    var date=new Date(r.completedAt).toLocaleDateString([],{day:'numeric',month:'long',year:'numeric'});
    var page=document.getElementById('page-adre-papers')||document.querySelector('.page.active');
    if(!page)return;
    var h='<div class="adre-cert-page"><div class="adre-cert"><div class="adre-cert-border">';
    h+='<div class="adre-cert-logo">🎓 Studyrya</div>';
    h+='<div class="adre-cert-title">Studyrya Previous-Year Mock Completion Certificate</div>';
    h+='<div class="adre-cert-subtitle">Practice certificate — not an official recruitment certificate</div>';
    h+='<div class="adre-cert-body"><div class="adre-cert-name">'+esc(r.userName)+'</div>';
    h+='<div class="adre-cert-text">has successfully completed the</div>';
    h+='<div class="adre-cert-exam">'+esc(r.paperTitle)+'</div>';
    h+='<div class="adre-cert-paper">'+esc(r.level)+' · '+r.totalQuestions+' Questions · '+r.totalMarks+' Marks</div>';
    h+='<div class="adre-cert-score-label">Score</div>';
    h+='<div class="adre-cert-score">'+r.finalScore+' / '+r.maxMarks+' ('+r.percentage+'%)</div>';
    h+='<div class="adre-cert-accuracy">Accuracy: '+r.accuracy+'%</div>';
    h+='<div class="adre-cert-date">'+date+'</div>';
    h+='<div class="adre-cert-id">Certificate ID: '+certId+'</div></div>';
    h+='<div class="adre-cert-footer">Studyrya Practice Certificate · Verify at studyria.qzz.io</div>';
    h+='</div></div>';
    h+='<div class="adre-cert-actions"><button class="adre-btn-primary" onclick="window.print()">🖨️ Print / Save PDF</button>';
    h+='<button class="adre-btn-secondary" onclick="ADREExam.showHome()">← Back</button></div></div>';
    page.innerHTML=h;
    window.scrollTo(0,0);
  }

  function viewResult(attemptId) {
    var hist=getHistory();
    var r=hist.find(function(a){return a.attemptId===attemptId;});
    if(r)renderResult(r);
  }

  function retry() { if(_state.paper)startPaper(_state.paper.id); }
  function showHome() {
    var page=document.getElementById('page-adre-papers');
    if(!page)return;
    if(_state.timerInterval)clearInterval(_state.timerInterval);
    _state.submitted=false;
    renderPaperList(page.querySelector('.adre-content')||page);
  }

  window.ADREExam={
    renderPaperList:renderPaperList,startPaper:startPaper,selectAnswer:selectAnswer,
    clearAnswer:clearAnswer,toggleMark:toggleMark,gotoQ:gotoQ,confirmSubmit:confirmSubmit,
    retry:retry,showHome:showHome,showCert:showCert,viewResult:viewResult
  };
  console.log('[ADRE] Exam engine loaded — '+window.ADRE_PAPERS.papers.length+' paper(s) available');
})();
