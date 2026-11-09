---
layout: page
title: 포트폴리오
permalink: /portfolio/
---

<div class="portfolio-page" markdown="1">

## 소개
{: .section-title}

[본인에 대한 소개와 어떤 분야에 관심이 있는지, 어떤 가치를 추구하는지 등을 작성하세요.]

---

## 프로젝트
{: .section-title}

<div class="project-cards">
{% assign projects = site.portfolio | sort: "order" %}
{% for project in projects %}
<div class="project-card">
  <h3><a href="{{ project.url | relative_url }}">{{ project.title | escape }}</a></h3>
  {% if project.period %}<p class="project-period">{{ project.period }}</p>{% endif %}
  {% if project.description %}<p class="project-desc">{{ project.description }}</p>{% endif %}
  {% if project.skills.size > 0 %}
  <div class="skill-tags">
    {% for skill in project.skills %}<span class="skill-tag">{{ skill }}</span>{% endfor %}
  </div>
  {% endif %}
  <div class="project-links">
    <a href="{{ project.url | relative_url }}">자세히 보기</a>
    {% if project.github %}<a href="{{ project.github }}">GitHub</a>{% endif %}
    {% if project.demo %}<a href="{{ project.demo }}">Demo</a>{% endif %}
  </div>
</div>
{% endfor %}
</div>

---

## 기술 역량
{: .section-title}

<div class="skill-summary">

<div class="skill-category">
  <h4>Language</h4>
  <div class="skill-tags">
    <span class="skill-tag">Swift</span>
    <span class="skill-tag">C++</span>
    <span class="skill-tag">Objective-C++</span>
  </div>
</div>

<div class="skill-category">
  <h4>Framework / Library</h4>
  <div class="skill-tags">
    <span class="skill-tag">SwiftUI</span>
    <span class="skill-tag">UIKit</span>
    <span class="skill-tag">AppKit</span>
    <span class="skill-tag">Combine</span>
    <span class="skill-tag">RxSwift</span>
    <span class="skill-tag">TCA</span>
    <span class="skill-tag">ReactorKit</span>
  </div>
</div>

<div class="skill-category">
  <h4>Apple Platform</h4>
  <div class="skill-tags">
    <span class="skill-tag">Network Extension</span>
    <span class="skill-tag">System Extension</span>
    <span class="skill-tag">App Extension</span>
    <span class="skill-tag">XPC</span>
    <span class="skill-tag">Privileged Daemon</span>
    <span class="skill-tag">Developer ID</span>
    <span class="skill-tag">Notarization</span>
    <span class="skill-tag">Installer Package (pkg)</span>
    <span class="skill-tag">App Store Connect</span>
    <span class="skill-tag">TestFlight</span>
    <span class="skill-tag">Apple Developer Enterprise Program</span>
  </div>
</div>

<div class="skill-category">
  <h4>Architecture / Tools</h4>
  <div class="skill-tags">
    <span class="skill-tag">Clean Architecture</span>
    <span class="skill-tag">Swift Package Manager</span>
    <span class="skill-tag">Tuist</span>
    <span class="skill-tag">RIBs</span>
    <span class="skill-tag">XCTest</span>
    <span class="skill-tag">Instruments</span>
    <span class="skill-tag">Git</span>
  </div>
</div>

</div>

</div>
