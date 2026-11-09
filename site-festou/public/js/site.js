/* Festou · página de vendas: planos, animações e formulário. */
(function () {
  'use strict'
  document.documentElement.classList.add('js')
  var CFG = window.FESTOU || {}
  var calmo = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  var toque = window.matchMedia('(hover: none)').matches
  var $ = function (s, el) { return (el || document).querySelector(s) }
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)) }

  /* ================= PLANOS ================= */
  // Os mesmos planos cadastrados no painel do Festou. Se o banco responder,
  // preço e limites vêm de lá (fica sempre igual ao sistema).
  var PLANOS = [
    { id: 'essencial', nome: 'Essencial', preco: 189.90, unidades: 1, usuarios: 5, adicional: 49.90,
      para: 'Para sair do caderno e do WhatsApp', pergunta: 'Financeiro: “quanto ganhei este mês?”',
      itens: ['Agenda de festas e visitas', 'Reservas, clientes e Central da festa', 'Contratos em PDF com os dados da festa', 'Portal da família com Pix por QR code', 'Cobrança em parcelas e lembretes do dia', 'Lista de convidados com check-in', 'Financeiro do dia a dia e resultado do mês'] },
    { id: 'profissional', nome: 'Profissional', preco: 279.90, unidades: 1, usuarios: 10, adicional: 49.90, destaque: true,
      para: 'Para vender mais e controlar a equipe', pergunta: 'Financeiro: “quais festas dão mais lucro?”',
      itens: ['=Tudo do Essencial, e mais:', 'Propostas comerciais em PDF', 'Comissões da equipe de vendas', 'Escalas da equipe por festa', 'Estoque, consumo e lista de compras', 'Acertos de estoque entre unidades', 'Lucro por festa'] },
    { id: 'master', nome: 'Master', preco: 369.90, unidades: 2, usuarios: null, adicional: 49.90,
      para: 'Para gerir a casa como empresa', pergunta: 'Financeiro: “como vai ser o mês que vem?”',
      itens: ['=Tudo do Profissional, e mais:', '2 unidades incluídas', 'Satisfação e pedido de avaliação no Google', 'Reativação de clientes pelo aniversário', 'Marketing: origem dos clientes, CAC e funil', 'Ponto de equilíbrio, projeção do caixa e comparativos', 'Relatório financeiro em PDF e Excel', 'Suporte prioritário no WhatsApp'] },
  ]
  var COMPARA = [
    ['g', 'Para todos os planos'],
    ['Agenda de festas e visitas', 1, 1, 1], ['Reservas, clientes e Central da festa', 1, 1, 1], ['Contratos em PDF', 1, 1, 1],
    ['Portal da família com Pix por QR code', 1, 1, 1], ['Cobrança em parcelas e lembretes do dia', 1, 1, 1], ['Lista de convidados com check-in', 1, 1, 1],
    ['Financeiro: visão geral, lançamentos e resultado do mês', 1, 1, 1], ['Permissões por perfil de usuário', 1, 1, 1], ['Sua logo no sistema e no portal', 1, 1, 1],
    ['Implantação e treinamento da equipe', 1, 1, 1], ['Suporte pelo WhatsApp', 1, 1, 1],
    ['g', 'Vendas e equipe'],
    ['Propostas comerciais em PDF', 0, 1, 1], ['Comissões', 0, 1, 1], ['Escalas da equipe', 0, 1, 1],
    ['g', 'Operação'],
    ['Estoque, consumo e lista de compras', 0, 1, 1], ['Acertos de estoque entre unidades', 0, 1, 1],
    ['g', 'Financeiro'],
    ['Lucro por festa', 0, 1, 1], ['Ponto de equilíbrio e projeção do caixa', 0, 0, 1], ['Comparativos entre meses e unidades', 0, 0, 1], ['Relatório em PDF e Excel', 0, 0, 1],
    ['g', 'Relacionamento e marketing'],
    ['Satisfação e pedido de avaliação no Google', 0, 0, 1], ['Reativação de clientes', 0, 0, 1], ['Marketing: origem, CAC e funil de vendas', 0, 0, 1], ['Suporte prioritário', 0, 0, 1],
    ['g', 'Limites'],
    ['u', 'Unidades incluídas'], ['p', 'Usuários'], ['a', 'Unidade a mais (por mês)'],
  ]

  var brl = function (v) { return 'R$ ' + v.toFixed(2).replace('.', ',') }
  function precoHtml(v) {
    var p = v.toFixed(2).split('.')
    return '<span class="rs">R$</span><span class="valor">' + p[0] + '</span><span class="cent">,' + p[1] + '</span><span class="mes">/mês</span>'
  }

  function desenharPlanos() {
    var box = $('#planos-cards')
    box.innerHTML = PLANOS.map(function (p) {
      var lim = '<span>' + p.unidades + (p.unidades === 1 ? ' unidade' : ' unidades') + '</span><span>' + (p.usuarios ? 'até ' + p.usuarios + ' usuários' : 'usuários ilimitados') + '</span>'
      var itens = p.itens.map(function (i) { return i.charAt(0) === '=' ? '<li class="tudo">' + i.slice(1) + '</li>' : '<li>' + i + '</li>' }).join('')
      return '<article class="plano' + (p.destaque ? ' destaque' : '') + '" data-plano="' + p.id + '">' +
        '<div class="brilho"></div>' + (p.destaque ? '<span class="fita">Mais escolhido</span>' : '') +
        '<h3>' + p.nome + '</h3><p class="para">' + p.para + '</p>' +
        '<div class="preco">' + precoHtml(p.preco) + '</div><div class="limites">' + lim + '</div>' +
        '<p class="pergunta-plano">' + p.pergunta + '</p><ul class="itens">' + itens + '</ul>' +
        '<a href="#contato" class="btn ' + (p.destaque ? 'btn-verde' : 'btn-roxo') + ' btn-bloco" data-escolher="' + p.nome + '">Quero o ' + p.nome + '</a></article>'
    }).join('')

    var t = $('#tabela-planos')
    var linhas = COMPARA.map(function (r) {
      if (r[0] === 'g') return '<tr class="grupo"><td colspan="4">' + r[1] + '</td></tr>'
      if (r[0] === 'u') return '<tr><td>' + r[1] + '</td>' + PLANOS.map(function (p) { return '<td><b>' + p.unidades + '</b></td>' }).join('') + '</tr>'
      if (r[0] === 'p') return '<tr><td>' + r[1] + '</td>' + PLANOS.map(function (p) { return '<td><b>' + (p.usuarios ? 'até ' + p.usuarios : 'ilimitados') + '</b></td>' }).join('') + '</tr>'
      if (r[0] === 'a') return '<tr><td>' + r[1] + '</td>' + PLANOS.map(function (p) { return '<td><b>' + brl(p.adicional) + '</b></td>' }).join('') + '</tr>'
      return '<tr><td>' + r[0] + '</td>' + [1, 2, 3].map(function (i) { return r[i] ? '<td class="sim" aria-label="incluído">✓</td>' : '<td class="nao" aria-label="não incluído">—</td>' }).join('') + '</tr>'
    }).join('')
    t.innerHTML = '<thead><tr><th>Recurso</th>' + PLANOS.map(function (p) { return '<th>' + p.nome + '<br><small>' + brl(p.preco) + '</small></th>' }).join('') + '</tr></thead><tbody>' + linhas + '</tbody>'

    var sel = $('#calc-plano')
    var atual = sel.value || 'profissional'
    sel.innerHTML = PLANOS.map(function (p) { return '<option value="' + p.id + '">' + p.nome + '</option>' }).join('')
    sel.value = atual
    calcular()
    ligarInclinacao()
  }

  var unidades = 1
  function calcular() {
    var p = PLANOS.filter(function (x) { return x.id === $('#calc-plano').value })[0] || PLANOS[1]
    var extras = Math.max(0, unidades - p.unidades)
    var total = p.preco + extras * p.adicional
    $('#calc-unidades').textContent = unidades
    $('#calc-conta').textContent = extras > 0 ? p.nome + ' ' + brl(p.preco) + ' + ' + extras + ' × ' + brl(p.adicional) : p.nome + (unidades < p.unidades ? ' (inclui ' + p.unidades + ' unidades)' : '')
    animarNumero($('#calc-valor'), total)
  }
  function animarNumero(el, valor) {
    var de = parseFloat((el.dataset.v || '0')) || 0
    el.dataset.v = valor
    if (calmo || !window.gsap) { el.textContent = brl(valor); return }
    var o = { v: de }
    gsap.to(o, { v: valor, duration: .5, ease: 'power2.out', onUpdate: function () { el.textContent = brl(o.v) } })
  }
  $('#calc-plano').addEventListener('change', calcular)
  $('#calc-mais').addEventListener('click', function () { unidades = Math.min(unidades + 1, 10); calcular() })
  $('#calc-menos').addEventListener('click', function () { unidades = Math.max(unidades - 1, 1); calcular() })
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-escolher]')
    if (b) { var s = $('#formulario select[name="plano"]'); if (s) s.value = b.dataset.escolher }
  })
  desenharPlanos()

  // Preço e limites do banco (os planos à venda no painel do Festou).
  if (CFG.supabaseUrl && CFG.supabaseKey && window.fetch) {
    fetch(CFG.supabaseUrl + '/rest/v1/rpc/platform_public_plans', { method: 'POST', headers: { apikey: CFG.supabaseKey, 'Content-Type': 'application/json' }, body: '{}' })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (lista) {
        if (!Array.isArray(lista) || !lista.length) return
        var mudou = false
        lista.forEach(function (x) {
          PLANOS.forEach(function (p) {
            if (p.id !== x.id) return
            p.preco = Number(x.preco); p.unidades = x.unidades_incluidas; p.usuarios = x.usuarios_incluidos; p.adicional = Number(x.unidade_adicional); p.destaque = !!x.destaque
            mudou = true
          })
        })
        if (mudou) desenharPlanos()
      })
      .catch(function () { /* fica com os valores da página */ })
  }

  /* ================= NAVEGAÇÃO ================= */
  var nav = $('.nav')
  var barra = $('.progress i')
  var zap = $('#whats-flutuante')
  function aoRolar() {
    var y = window.scrollY
    nav.classList.toggle('solida', y > 40)
    var h = document.documentElement.scrollHeight - window.innerHeight
    barra.style.transform = 'scaleX(' + (h > 0 ? y / h : 0) + ')'
    zap.classList.toggle('visivel', y > window.innerHeight * .7)
  }
  window.addEventListener('scroll', aoRolar, { passive: true })
  aoRolar()
  $('.nav-menu').addEventListener('click', function () {
    var aberta = nav.classList.toggle('aberta')
    this.setAttribute('aria-expanded', aberta ? 'true' : 'false')
  })
  $$('.nav a').forEach(function (a) { a.addEventListener('click', function () { nav.classList.remove('aberta') }) })

  // WhatsApp
  function linkZap(texto) { return 'https://wa.me/' + (CFG.whatsapp || '5547992245959') + '?text=' + encodeURIComponent(texto) }
  zap.href = linkZap('Olá! Vim pelo site e quero conhecer o Festou.')
  $('#whats-direto').href = linkZap('Olá! Vim pelo site e quero agendar uma demonstração do Festou.')
  $('#ano').textContent = new Date().getFullYear()

  // brilho do hero acompanha o mouse
  var hero = $('.hero')
  if (!toque) hero.addEventListener('pointermove', function (e) {
    var r = hero.getBoundingClientRect()
    hero.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100) + '%')
    hero.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100) + '%')
  })

  /* ================= CARTÕES 3D (planos) e botões magnéticos ================= */
  function ligarInclinacao() {
    if (toque || calmo) return
    $$('.plano').forEach(function (c) {
      if (c.dataset.inclina) return
      c.dataset.inclina = '1'
      var base = c.classList.contains('destaque') ? -14 : 0
      c.addEventListener('pointermove', function (e) {
        var r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height
        c.style.transform = 'perspective(1200px) translateY(' + (base - 6) + 'px) rotateX(' + ((.5 - y) * 8) + 'deg) rotateY(' + ((x - .5) * 10) + 'deg)'
        c.style.setProperty('--gx', x * 100 + '%'); c.style.setProperty('--gy', y * 100 + '%')
      })
      c.addEventListener('pointerleave', function () { c.style.transition = 'transform .6s cubic-bezier(.2,.8,.2,1), box-shadow .4s'; c.style.transform = ''; setTimeout(function () { c.style.transition = '' }, 600) })
    })
  }
  if (!toque && !calmo) $$('.magnet').forEach(function (b) {
    b.addEventListener('pointermove', function (e) {
      var r = b.getBoundingClientRect()
      b.style.transform = 'translate(' + ((e.clientX - r.left - r.width / 2) * .18) + 'px,' + ((e.clientY - r.top - r.height / 2) * .28) + 'px)'
    })
    b.addEventListener('pointerleave', function () { b.style.transform = '' })
  })

  /* ================= PORTAL: troca de telas ================= */
  var passos = $$('.passos li'), telas = $$('.celular .tela'), telaAtual = 0
  function mostrarTela(i) {
    if (i === telaAtual) return
    telaAtual = i
    passos.forEach(function (p, k) { p.classList.toggle('ativo', k === i) })
    telas.forEach(function (t, k) { t.classList.toggle('ativa', k === i) })
  }
  passos.forEach(function (p, k) { p.addEventListener('click', function () { mostrarTela(k) }) })

  /* ================= FORMULÁRIO ================= */
  var form = $('#formulario'), retorno = $('.form-retorno', form)
  function utm() {
    var q = new URLSearchParams(location.search)
    if (q.get('gclid')) return 'Google Ads'
    return [q.get('utm_source'), q.get('utm_campaign')].filter(Boolean).join(' / ')
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault()
    var d = {}
    new FormData(form).forEach(function (v, k) { d[k] = String(v).trim() })
    $$('.invalido', form).forEach(function (el) { el.classList.remove('invalido') })
    if (d.site) return // robô
    var erros = []
    if (!d.nome) erros.push('nome')
    if ((d.whatsapp || '').replace(/\D/g, '').length < 10) erros.push('whatsapp')
    if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) erros.push('email')
    if (erros.length) {
      erros.forEach(function (n) { form.elements[n].classList.add('invalido') })
      form.elements[erros[0]].focus()
      retorno.className = 'form-retorno erro'
      retorno.textContent = erros[0] === 'nome' ? 'Conte o seu nome.' : erros[0] === 'whatsapp' ? 'Informe o WhatsApp com DDD.' : 'Confira o e-mail.'
      return
    }
    var btn = $('button[type="submit"]', form)
    btn.disabled = true
    btn.textContent = 'Enviando...'
    var dados = { nome: d.nome, casa: d.casa, cidade: d.cidade, whatsapp: d.whatsapp, email: d.email, plano: d.plano, mensagem: d.mensagem, utm: utm() }
    var textoZap = 'Olá! Sou ' + d.nome + (d.casa ? ', da ' + d.casa : '') + (d.cidade ? ' (' + d.cidade + ')' : '') + '. Quero agendar uma demonstração do Festou' + (d.plano ? ' (plano ' + d.plano + ')' : '') + '.'
    function sucesso() {
      form.classList.add('enviado')
      retorno.className = 'form-retorno ok'
      retorno.innerHTML = '🎉 Recebemos! Vamos chamar você no WhatsApp para combinar a demonstração.<br><br><a class="btn btn-verde" href="' + linkZap(textoZap) + '" target="_blank" rel="noopener">Quer adiantar? Chame agora no WhatsApp</a>'
      if (window.gtag) window.gtag('event', 'generate_lead', { plano: d.plano || 'indefinido' })
      soltarConfete()
    }
    function falha(msg) {
      btn.disabled = false
      btn.textContent = 'Quero agendar a demonstração'
      retorno.className = 'form-retorno erro'
      retorno.innerHTML = (msg || 'Não conseguimos enviar agora.') + ' <a href="' + linkZap(textoZap) + '" target="_blank" rel="noopener">Chame no WhatsApp</a>.'
    }
    if (!CFG.supabaseUrl || !CFG.supabaseKey) return falha()
    fetch(CFG.supabaseUrl + '/rest/v1/rpc/platform_lead_submit', { method: 'POST', headers: { apikey: CFG.supabaseKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_dados: dados }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j } }) })
      .then(function (x) { if (x.ok) sucesso(); else falha(x.j && x.j.message) })
      .catch(function () { falha() })
  })

  // confete ao enviar (leve, em canvas)
  function soltarConfete() {
    if (calmo) return
    var c = document.createElement('canvas'), ctx = c.getContext('2d'), W = c.width = innerWidth, H = c.height = innerHeight
    c.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:70'
    document.body.appendChild(c)
    var cores = ['#59239B', '#4FAB7C', '#B58CF0', '#FFC94D', '#ffffff'], ps = []
    for (var i = 0; i < 160; i++) ps.push({ x: W / 2, y: H * .55, vx: (Math.random() - .5) * 18, vy: -Math.random() * 18 - 6, r: Math.random() * 6 + 4, a: Math.random() * 6, va: (Math.random() - .5) * .3, c: cores[i % cores.length] })
    var t0 = performance.now()
    ;(function quadro(t) {
      ctx.clearRect(0, 0, W, H)
      ps.forEach(function (p) { p.vy += .45; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.a += p.va; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); ctx.restore() })
      if (t - t0 < 3200) requestAnimationFrame(quadro); else c.remove()
    })(t0)
  }

  /* ================= ANIMAÇÕES AO ROLAR (GSAP) ================= */
  if (!window.gsap || !window.ScrollTrigger || calmo) {
    $$('.revelar').forEach(function (el) { el.style.opacity = 1; el.style.transform = 'none' })
    $$('.carta').forEach(function (c) { c.classList.add('virada') })
    $$('.bolha').forEach(function (b) { b.classList.add('riscada') })
    // sem animação: o celular troca de tela sozinho
    setInterval(function () { mostrarTela((telaAtual + 1) % telas.length) }, 4000)
    return
  }
  gsap.registerPlugin(ScrollTrigger)

  // hero: título, textos e mensagens que o Festou "resolve"
  var tl = gsap.timeline({ defaults: { ease: 'power4.out' } })
  tl.from('.selo', { y: 20, opacity: 0, duration: .8 })
    .from('.hero-titulo .linha > span', { yPercent: 110, rotate: 4, duration: 1.2, stagger: .12 }, '-=.5')
    .from('.hero-sub', { y: 30, opacity: 0, duration: 1 }, '-=.8')
    .from('.hero-ctas > *', { y: 24, opacity: 0, duration: .8, stagger: .1 }, '-=.7')
    .from('.hero-prova', { opacity: 0, duration: .8 }, '-=.5')
    .from('.bolha', { scale: .6, y: 40, opacity: 0, duration: .9, stagger: .18, ease: 'back.out(1.7)' }, '-=.9')
  $$('.bolha').forEach(function (b, i) {
    gsap.to(b, { y: '+=' + (10 + i * 3), duration: 2.6 + i * .4, yoyo: true, repeat: -1, ease: 'sine.inOut', delay: 1.5 })
  })
  ScrollTrigger.create({
    trigger: '.hero', start: 'top top', end: 'bottom top',
    onUpdate: function (s) { $$('.bolha').forEach(function (b, i) { b.classList.toggle('riscada', s.progress > .05 + i * .08) }) },
  })
  gsap.to('.bolhas', { yPercent: -40, opacity: 0, ease: 'none', scrollTrigger: { trigger: '.hero', start: '20% top', end: 'bottom top', scrub: true } })
  gsap.to('.hero-conteudo', { yPercent: 25, opacity: .2, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } })

  // faixa acelera e inclina com a velocidade da rolagem
  var faixa = $('.faixa-trilho')
  ScrollTrigger.create({ onUpdate: function (s) {
    var v = gsap.utils.clamp(-8, 8, s.getVelocity() / 300)
    gsap.to(faixa, { skewX: -v, duration: .4, overwrite: true })
  } })

  // revelar blocos
  ScrollTrigger.batch('.revelar', {
    start: 'top 86%',
    onEnter: function (els) { gsap.to(els, { opacity: 1, y: 0, duration: 1, stagger: .12, ease: 'power3.out', overwrite: true }) },
  })

  // cartas: o problema vira solução
  $$('.carta').forEach(function (c, i) {
    gsap.from(c, { y: 60, opacity: 0, rotateX: -18, duration: 1, ease: 'power3.out', delay: (i % 3) * .1, scrollTrigger: { trigger: c, start: 'top 90%' } })
    ScrollTrigger.create({
      trigger: c, start: 'top 58%',
      onEnter: function () { setTimeout(function () { c.classList.add('virada') }, (i % 3) * 140) },
      onLeaveBack: function () { c.classList.remove('virada') },
    })
  })

  var mm = gsap.matchMedia()

  // computador: portal fixo enquanto as telas trocam; sistema em rolagem lateral
  mm.add('(min-width: 901px)', function () {
    ScrollTrigger.create({
      trigger: '.portal', start: 'top top', end: '+=260%', pin: '.portal-fixo', scrub: true,
      onUpdate: function (s) { mostrarTela(Math.min(telas.length - 1, Math.floor(s.progress * telas.length * .999))) },
    })
    gsap.fromTo('.celular', { rotateY: -24, rotateX: 8, rotateZ: 3 }, { rotateY: 16, rotateX: -4, rotateZ: -2, ease: 'none', scrollTrigger: { trigger: '.portal', start: 'top top', end: '+=260%', scrub: true } })
    gsap.from('.portal-texto > *', { x: -50, opacity: 0, duration: 1, stagger: .1, ease: 'power3.out', scrollTrigger: { trigger: '.portal', start: 'top 70%' } })

    var trilho = $('#trilho')
    var distancia = function () { return Math.max(0, trilho.scrollWidth - window.innerWidth + 120) }
    var lateral = gsap.to(trilho, { x: function () { return -distancia() }, ease: 'none', scrollTrigger: { trigger: '.sistema', start: 'top top', end: function () { return '+=' + distancia() }, pin: '.sistema-fixo', scrub: 1, invalidateOnRefresh: true } })
    $$('.painel .navegador').forEach(function (n) {
      gsap.fromTo(n, { rotateY: -14, scale: .92 }, { rotateY: 4, scale: 1, ease: 'none', scrollTrigger: { trigger: n, containerAnimation: lateral, start: 'left 95%', end: 'right 30%', scrub: true } })
    })
  })

  // celular: as telas do portal trocam sozinhas quando o portal está na tela
  mm.add('(max-width: 900px)', function () {
    var timer = null
    ScrollTrigger.create({
      trigger: '.portal', start: 'top 60%', end: 'bottom 40%',
      onToggle: function (s) {
        clearInterval(timer)
        if (s.isActive) timer = setInterval(function () { mostrarTela((telaAtual + 1) % telas.length) }, 3200)
      },
    })
    $$('.painel').forEach(function (p) { gsap.from(p, { y: 60, opacity: 0, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: p, start: 'top 88%' } }) })
    return function () { clearInterval(timer) }
  })

  // escada do financeiro: sobe degrau por degrau
  gsap.from('.degrau', { y: 120, opacity: 0, rotateX: 20, transformOrigin: '50% 100%', stagger: .18, duration: 1.1, ease: 'power3.out', scrollTrigger: { trigger: '.escada', start: 'top 80%' } })

  // planos
  gsap.from('.plano', { y: 80, opacity: 0, stagger: .12, duration: 1.1, ease: 'power3.out', scrollTrigger: { trigger: '.planos', start: 'top 85%' } })

  // linha do tempo desenhando
  gsap.to('#linha-path', { strokeDashoffset: 0, ease: 'none', scrollTrigger: { trigger: '.linha-tempo', start: 'top 75%', end: 'bottom 55%', scrub: true } })
  gsap.from('.etapa', { y: 40, opacity: 0, stagger: .15, duration: .9, ease: 'back.out(1.6)', scrollTrigger: { trigger: '.linha-tempo', start: 'top 80%' } })
  gsap.from('.garantias span', { scale: .8, opacity: 0, stagger: .08, duration: .6, ease: 'back.out(2)', scrollTrigger: { trigger: '.garantias', start: 'top 90%' } })

  // história: citação palavra a palavra
  gsap.from('.historia blockquote', { backgroundPositionX: '100%', opacity: 0, y: 40, duration: 1.2, ease: 'power3.out', scrollTrigger: { trigger: '.historia', start: 'top 70%' } })

  window.addEventListener('load', function () { ScrollTrigger.refresh() })
})()
