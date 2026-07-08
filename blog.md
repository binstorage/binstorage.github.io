---
layout: page
title: 기술 블로그
permalink: /blog/
---

<div class="blog-page">

{% if site.posts.size > 0 %}
{% assign all_categories = "" | split: "" %}
{% for post in site.posts %}
  {% for cat in post.categories %}
    {% unless all_categories contains cat %}
      {% assign all_categories = all_categories | push: cat %}
    {% endunless %}
  {% endfor %}
{% endfor %}
<div class="blog-filter">
  <button class="blog-filter__btn blog-filter__btn--active" data-category="all">전체</button>
  {% for cat in all_categories %}
  <button class="blog-filter__btn" data-category="{{ cat }}">{{ cat }}</button>
  {% endfor %}
</div>

<div class="post-list">
  {% for post in site.posts %}
  <a href="{{ post.url | relative_url }}" class="post-card" data-category="{{ post.categories | join: ',' }}">
    <div class="post-card__content">
      <h3 class="post-card__title">{{ post.title | escape }}</h3>
      {% if post.description %}
      <p class="post-card__desc">{{ post.description }}</p>
      {% elsif post.excerpt %}
      <p class="post-card__desc">{{ post.excerpt | strip_html | truncate: 120 }}</p>
      {% endif %}
      <div class="post-card__meta">
        <time datetime="{{ post.date | date_to_xmlschema }}">{{ post.date | date: "%Y년 %m월 %d일" }}</time>
        {% if post.categories.size > 0 %}
        <div class="post-card__categories">
          {% for cat in post.categories %}
          <span class="skill-tag">{{ cat }}</span>
          {% endfor %}
        </div>
        {% endif %}
      </div>
    </div>
  </a>
  {% endfor %}
</div>
{% else %}
<p class="blog-empty">아직 작성된 글이 없습니다.</p>
{% endif %}

</div>
