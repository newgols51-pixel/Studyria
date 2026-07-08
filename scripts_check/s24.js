
  function contactPickTopic(btn) {
    document.querySelectorAll('.contact-topic-pill').forEach(function(p){ p.classList.remove('active'); });
    btn.classList.add('active');
  }
  function contactToggleFaq(btn) {
    var answer = btn.nextElementSibling;
    var isOpen = answer.classList.contains('open');
    // Close all
    document.querySelectorAll('.contact-faq-a').forEach(function(a){ a.classList.remove('open'); });
    document.querySelectorAll('.contact-faq-q').forEach(function(q){ q.classList.remove('open'); });
    // Toggle clicked
    if (!isOpen) {
      answer.classList.add('open');
      btn.classList.add('open');
    }
  }
  