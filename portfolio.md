---
layout: page
title: 포트폴리오
permalink: /portfolio/
---

<div class="portfolio-page">

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
  <h4>Frontend</h4>
  <div class="skill-tags">
    <span class="skill-tag">[기술1]</span>
    <span class="skill-tag">[기술2]</span>
  </div>
</div>

<div class="skill-category">
  <h4>Backend</h4>
  <div class="skill-tags">
    <span class="skill-tag">[기술1]</span>
    <span class="skill-tag">[기술2]</span>
  </div>
</div>

<div class="skill-category">
  <h4>DevOps / Infra</h4>
  <div class="skill-tags">
    <span class="skill-tag">[기술1]</span>
    <span class="skill-tag">[기술2]</span>
  </div>
</div>

<div class="skill-category">
  <h4>기타</h4>
  <div class="skill-tags">
    <span class="skill-tag">[기술1]</span>
    <span class="skill-tag">[기술2]</span>
  </div>
</div>

</div>

---

## 연락처
{: .section-title}

- **이메일**: [email@example.com]
- **GitHub**: [https://github.com/username]
- **블로그**: [블로그 URL]

</div>
