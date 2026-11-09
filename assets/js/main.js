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

  // Blog category filter
  var filterBtns = document.querySelectorAll('.blog-filter__btn');
  if (filterBtns.length > 0) {
    var postCards = document.querySelectorAll('.post-card[data-category]');

    filterBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var category = this.getAttribute('data-category');

        filterBtns.forEach(function (b) {
          b.classList.remove('blog-filter__btn--active');
        });
        this.classList.add('blog-filter__btn--active');

        postCards.forEach(function (card) {
          if (category === 'all') {
            card.classList.remove('post-card--hidden');
          } else {
            var cats = card.getAttribute('data-category').split(',');
            if (cats.indexOf(category) !== -1) {
              card.classList.remove('post-card--hidden');
            } else {
              card.classList.add('post-card--hidden');
            }
          }
        });
      });
    });
  }

  // Code block header: language label + copy button
  // plaintext(언어 미지정)는 다이어그램이므로 헤더를 달지 않음
  var CODE_LABELS = {
    bash: { label: 'Terminal', copy: true, modifier: 'terminal' },
    shell: { label: 'Terminal', copy: true, modifier: 'terminal' },
    sh: { label: 'Terminal', copy: true, modifier: 'terminal' },
    zsh: { label: 'Terminal', copy: true, modifier: 'terminal' },
    console: { label: 'Terminal', copy: true, modifier: 'terminal' },
    text: { label: '출력 예시', copy: false, modifier: 'output' },
    swift: { label: 'Swift', copy: true },
    objc: { label: 'Objective-C', copy: true },
    c: { label: 'C', copy: true },
    xml: { label: 'XML / plist', copy: true },
    json: { label: 'JSON', copy: true },
    yaml: { label: 'YAML', copy: true }
  };

  var codeBlocks = document.querySelectorAll('.post-article__content div.highlighter-rouge');
  codeBlocks.forEach(function (block) {
    var match = block.className.match(/language-(\S+)/);
    var info = match && CODE_LABELS[match[1]];
    if (!info) return;

    if (info.modifier) block.classList.add('code-block--' + info.modifier);

    var header = document.createElement('div');
    header.className = 'code-header';
    var label = document.createElement('span');
    label.className = 'code-header__label';
    label.innerHTML = '<span class="code-header__dot"></span>';
    label.appendChild(document.createTextNode(info.label));
    header.appendChild(label);

    if (info.copy && navigator.clipboard) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'code-copy';
      button.textContent = '복사';
      button.addEventListener('click', function () {
        var code = block.querySelector('pre code');
        navigator.clipboard.writeText(code.innerText.replace(/\n$/, '')).then(function () {
          button.textContent = '복사됨';
          button.classList.add('code-copy--done');
          setTimeout(function () {
            button.textContent = '복사';
            button.classList.remove('code-copy--done');
          }, 1500);
        });
      });
      header.appendChild(button);
    }

    block.insertBefore(header, block.firstChild);
  });
})();
