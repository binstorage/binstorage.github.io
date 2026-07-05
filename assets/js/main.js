(function () {
  // Dark mode toggle
  var checkbox = document.getElementById('theme-checkbox');
  var html = document.documentElement;

  // Sync checkbox with current state
  if (html.getAttribute('data-theme') === 'dark') {
    checkbox.checked = true;
  }

  checkbox.addEventListener('change', function () {
    if (this.checked) {
      html.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
    } else {
      html.removeAttribute('data-theme');
      localStorage.setItem('theme', 'light');
    }
  });

  // Mobile menu toggle
  var hamburger = document.getElementById('hamburger');
  var sidebar = document.getElementById('sidebar');
  var overlay = document.getElementById('sidebar-overlay');

  function openMenu() {
    hamburger.classList.add('hamburger--active');
    sidebar.classList.add('site__sidebar--open');
    overlay.classList.add('sidebar-overlay--active');
    document.body.style.overflow = 'hidden';
  }

  function closeMenu() {
    hamburger.classList.remove('hamburger--active');
    sidebar.classList.remove('site__sidebar--open');
    overlay.classList.remove('sidebar-overlay--active');
    document.body.style.overflow = '';
  }

  hamburger.addEventListener('click', function () {
    if (sidebar.classList.contains('site__sidebar--open')) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  overlay.addEventListener('click', closeMenu);

  // Close menu on nav link click (mobile)
  var navLinks = sidebar.querySelectorAll('.sidebar__nav-link');
  for (var i = 0; i < navLinks.length; i++) {
    navLinks[i].addEventListener('click', closeMenu);
  }
})();
