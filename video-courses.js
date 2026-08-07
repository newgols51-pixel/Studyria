/**
 * ═══════════════════════════════════════════════════════════════════════════
 * video-courses.js — Studyria V5.1 Module 4: Premium Video Courses
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

(function (root) {
  const R = () => root.StudyriaRevenue;
  if (!R()) { console.error('[VideoCourses] Core not loaded'); return; }

  let _category = 'all';

  async function render(container) {
    if (!container) return;
    const user = await R()._user();
    container.innerHTML = `
      <div class="rm-tabs" id="vcTabs">
        <div class="rm-tab active" onclick="VideoCourses._cat('all')">All Courses</div>
        <div class="rm-tab" onclick="VideoCourses._cat('continue')">Continue Watching</div>
        <div class="rm-tab" onclick="VideoCourses._cat('enrolled')">My Courses</div>
      </div>
      <div id="vcContent">${R().skeletonHTML(6)}</div>`;
    _loadCourses();
  }

  function _cat(c) {
    _category = c;
    document.querySelectorAll('#vcTabs .rm-tab').forEach(t => t.classList.remove('active'));
    event?.target?.classList.add('active');
    _loadCourses();
  }

  async function _loadCourses() {
    const c = document.getElementById('vcContent');
    if (!c) return;
    c.innerHTML = R().skeletonHTML(6);
    try {
      if (_category === 'enrolled' || _category === 'continue') {
        const user = await R()._user();
        if (!user) { c.innerHTML = R().emptyHTML('🔒', 'Please login to view your courses.'); return; }
        const { data: enrollments } = await R()._sb().from('course_enrollments')
          .select('id,course_id,progress_percent,completed_lessons,is_completed,enrolled_at,completed_at,courses(id,title,description,thumbnail_url,total_lessons,total_duration_seconds,rating_avg,enrolled_count)')
          .eq('user_id', user.id).order('enrolled_at', { ascending: false });
        if (!enrollments?.length) { c.innerHTML = R().emptyHTML('📚', 'No enrolled courses yet.'); return; }
        if (_category === 'continue') {
          const inProgress = enrollments.filter(e => !e.is_completed && e.progress_percent > 0);
          if (!inProgress.length) { c.innerHTML = R().emptyHTML('✅', 'All courses completed!'); return; }
          c.innerHTML = `<div class="rm-grid rm-grid-3">${inProgress.map(e => _courseCard(e.courses, e)).join('')}</div>`;
        } else {
          c.innerHTML = `<div class="rm-grid rm-grid-3">${enrollments.map(e => _courseCard(e.courses, e)).join('')}</div>`;
        }
      } else {
        const courses = await R().safeQuery('courses', {
          select: 'id,title,description,category,thumbnail_url,is_premium,total_lessons,total_duration_seconds,rating_avg,rating_count,enrolled_count,creator_name,sort_order',
          order: { column: 'sort_order', ascending: true }, limit: 30
        });
        if (!courses.length) { c.innerHTML = R().emptyHTML('📚', 'No courses available yet.'); return; }
        c.innerHTML = `<div class="rm-grid rm-grid-3">${courses.map(co => _courseCard(co)).join('')}</div>`;
      }
    } catch (e) { c.innerHTML = R().errorHTML(e.message); }
  }

  function _courseCard(c, enrollment) {
    if (!c) return '';
    const progress = enrollment?.progress_percent || 0;
    return `<div class="rm-card rm-product-card" onclick="VideoCourses.openCourse('${c.id}')">
      <div class="rm-product-thumb">${c.thumbnail_url ? `<img src="${R().sanitize(c.thumbnail_url)}" style="width:100%;height:100%;border-radius:inherit;object-fit:cover" alt="">` : '🎓'}
        ${c.is_premium ? '<span class="rm-badge rm-badge-premium" style="position:absolute;top:8px;right:8px">⭐ Premium</span>' : ''}
      </div>
      <h3 class="rm-card-title">${R().sanitize(c.title)}</h3>
      <p class="rm-card-subtitle">${R().sanitize(c.description?.slice(0, 80) || '')}</p>
      <div style="display:flex;gap:8px;margin:8px 0;font-size:0.78rem;color:var(--rm-text-muted)">
        <span>📚 ${c.total_lessons || 0} lessons</span>
        ${c.rating_avg > 0 ? `<span>⭐ ${c.rating_avg}</span>` : ''}
        <span>👥 ${c.enrolled_count || 0}</span>
      </div>
      ${progress > 0 ? `<div class="rm-progress"><div class="rm-progress-fill" style="width:${progress}%"></div></div>
        <div style="font-size:0.72rem;color:var(--rm-text-muted);margin-top:4px">${Math.round(progress)}% complete</div>` : ''}
      ${c.creator_name ? `<div style="font-size:0.75rem;color:var(--rm-text-muted)">By ${R().sanitize(c.creator_name)}</div>` : ''}
    </div>`;
  }

  async function openCourse(courseId) {
    try {
      const { data: course } = await R()._sb().from('courses').select('*').eq('id', courseId).single();
      if (!course) return;
      const { data: lessons } = await R()._sb().from('course_lessons')
        .select('id,title,description,video_url,notes_url,duration_seconds,is_preview,sort_order')
        .eq('course_id', courseId).is('deleted_at', null).order('sort_order', { ascending: true });

      const user = await R()._user();
      let enrolled = false;
      if (user) {
        const { data: e } = await R()._sb().from('course_enrollments').select('id,progress_percent,completed_lessons').eq('course_id', courseId).eq('user_id', user.id).single();
        enrolled = !!e;
      }

      const modal = R().openModal(course.title, `
        <div style="display:flex;gap:8px;margin-bottom:12px">
          <span class="rm-badge ${course.is_premium ? 'rm-badge-premium' : 'rm-badge-free'}">${course.is_premium ? 'Premium' : 'Free'}</span>
          ${course.category ? `<span class="rm-badge rm-badge-new">${R().sanitize(course.category)}</span>` : ''}
        </div>
        <p class="rm-card-subtitle">${R().sanitize(course.description || '')}</p>
        ${!enrolled && user ? `<button class="rm-btn rm-btn-primary" style="width:100%;margin:12px 0" onclick="VideoCourses._enroll('${courseId}')">Enroll Now</button>` : ''}
        ${!user ? `<button class="rm-btn rm-btn-primary" style="width:100%;margin:12px 0" onclick="navigate('login')">Login to Enroll</button>` : ''}
        <h3 style="color:var(--rm-text);margin:16px 0 8px;font-size:1rem">Lessons (${lessons?.length || 0})</h3>
        <div id="vcLessons">${(lessons || []).map((l, i) => `
          <div class="rm-card" style="margin-bottom:8px;display:flex;align-items:center;gap:12px;cursor:pointer" onclick="VideoCourses._playLesson('${l.id}','${courseId}','${course.is_premium}')">
            <div style="width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:center;font-weight:700">${i+1}</div>
            <div style="flex:1">
              <div style="font-weight:600;color:var(--rm-text);font-size:0.88rem">${R().sanitize(l.title)}</div>
              <div style="font-size:0.75rem;color:var(--rm-text-muted)">${R().formatTime(l.duration_seconds||0)}</div>
            </div>
            ${l.is_preview ? '<span class="rm-badge rm-badge-free">Preview</span>' : (course.is_premium && !enrolled ? '<span class="rm-badge rm-badge-premium">🔒</span>' : '▶️')}
          </div>`).join('')}</div>
      `);
    } catch (e) { R().toast('Error: ' + e.message, 'error'); }
  }

  async function _enroll(courseId) {
    const user = await R()._user();
    if (!user) { R().toast('Please login to enroll.', 'info'); return; }
    try {
      await R().safeInsert('course_enrollments', { course_id: courseId, user_id: user.id, progress_percent: 0, completed_lessons: [] });
      R().closeModal();
      R().toast('Enrolled successfully!', 'success');
      openCourse(courseId);
    } catch (e) { R().toast('Enrollment failed: ' + e.message, 'error'); }
  }

  async function _playLesson(lessonId, courseId, isPremium) {
    const user = await R()._user();
    if (isPremium && !user) { R().toast('Premium course. Please login & enroll.', 'info'); return; }

    try {
      const { data: lesson } = await R()._sb().from('course_lessons').select('*').eq('id', lessonId).single();
      if (!lesson) return;

      if (isPremium && !lesson.is_preview) {
        if (!user) { R().toast('Please login to watch this lesson.', 'info'); return; }
        const { data: e } = await R()._sb().from('course_enrollments').select('id').eq('course_id', courseId).eq('user_id', user.id).single();
        if (!e) { R().toast('Please enroll to watch this lesson.', 'info'); return; }
      }

      R().closeModal();
      const page = document.getElementById('page-video-courses');
      if (page) {
        page.innerHTML = `<div class="rm-container" style="max-width:900px">
          <button class="rm-btn rm-btn-ghost" style="margin-bottom:16px" onclick="navigate('video-courses')">← Back</button>
          <h1 style="color:var(--rm-text);margin-bottom:12px">${R().sanitize(lesson.title)}</h1>
          <div style="border-radius:var(--rm-radius);overflow:hidden;margin-bottom:16px">
            <video src="${R().sanitize(lesson.video_url)}" controls autoplay style="width:100%;border-radius:var(--rm-radius)"></video>
          </div>
          <p class="rm-card-subtitle">${R().sanitize(lesson.description || '')}</p>
          ${lesson.notes_url ? `<a href="${R().sanitize(lesson.notes_url)}" target="_blank" class="rm-btn rm-btn-ghost" style="margin-top:12px">📥 Download Notes</a>` : ''}
        </div>`;
      }

      // Track progress
      if (user) {
        const { data: e } = await R()._sb().from('course_enrollments').select('id,completed_lessons').eq('course_id', courseId).eq('user_id', user.id).single();
        if (e) {
          const completed = e.completed_lessons || [];
          if (!completed.includes(lessonId)) {
            completed.push(lessonId);
            const total = await R()._sb().from('course_lessons').select('id', { count: 'exact' }).eq('course_id', courseId).is('deleted_at', null);
            const pct = total.count > 0 ? Math.round((completed.length / total.count) * 100) : 0;
            await R().safeUpdate('course_enrollments', e.id, { completed_lessons: completed, progress_percent: pct, is_completed: pct >= 100, completed_at: pct >= 100 ? new Date().toISOString() : null });
          }
        }
      }
    } catch (e) { R().toast('Error playing lesson: ' + e.message, 'error'); }
  }

  // ── Export ────────────────────────────────────────────────────────────────
  root.VideoCourses = Object.freeze({
    render, openCourse, _cat, _enroll, _playLesson,
    init: () => { const p = document.getElementById('page-video-courses'); if (p && p.classList.contains('active')) render(p); }
  });

  R().register('videoCourses', root.VideoCourses);
  console.log('[VideoCourses] V5.1 loaded.');

}(typeof self !== 'undefined' ? self : this));
