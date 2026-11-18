/* Offline reference for the scientific calculator. */
(() => {
  'use strict';
  const catalogue = {
    maths: [
      ["Geometry", [
        ["triangle","Triangles",["A = bh/2","P = a + b + c","s = P/2","A = √[s(s − a)(s − b)(s − c)]","α + β + γ = 180°"],"A is area, P is perimeter, h is perpendicular to base b, and s is the semiperimeter. The square-root equation is Heron’s formula."],
        ["median","Triangle median",["mᵦ = ½√(2a² + 2c² − b²)"],"mᵦ runs from the opposite vertex to the midpoint of side b."],
        ["right-triangle","Pythagorean theorem",["a² + b² = c²"],"For a right triangle with legs a and b and hypotenuse c."],
        ["circle","Circles and sectors",["A = πr²","C = 2πr","ℓ = rθ","Aₛ = ½r²θ"],"For arc length ℓ and sector area Aₛ, θ is in radians."],
        ["solids","Common solid volumes",["Cylinder: V = πr²h","Cone: V = ⅓πr²h","Sphere: V = ⁴⁄₃πr³"],"r is the radius and h is the perpendicular height."]
      ]],
      ["Algebra", [
        ["powers","Powers and logarithms",["aᵐaⁿ = aᵐ⁺ⁿ","(aᵐ)ⁿ = aᵐⁿ","logᵦ(xy) = logᵦ x + logᵦ y","logᵦ(xʳ) = r logᵦ x"],"For real logarithms, x and y are positive and the base b is positive and differs from 1."],
        ["sequences","Arithmetic and geometric sequences",["aₙ = a₁ + (n − 1)d","Sₙ = n(a₁ + aₙ)/2","aₙ = a₁rⁿ⁻¹","Sₙ = a₁(1 − rⁿ)/(1 − r)"],"d is the common difference and r is the ratio. For r = 1 the geometric sum is na₁."]
      ]],
      ["Trigonometry", [
        ["right-trig","Right-triangle ratios",["sin θ = opposite / hypotenuse","cos θ = adjacent / hypotenuse","tan θ = opposite / adjacent"],"The sides are named relative to the angle θ."],
        ["identities","Trigonometric identities",["sin² θ + cos² θ = 1","tan θ = sin θ / cos θ","sin(α + β) = sin α cos β + cos α sin β","cos(α + β) = cos α cos β − sin α sin β"],"The tangent identity requires cos θ ≠ 0."],
        ["sine-cosine-laws","Sine and cosine laws",["a / sin A = b / sin B = c / sin C","c² = a² + b² − 2ab cos C"],"A, B and C are the angles opposite sides a, b and c."]
      ]],
      ["Equations", [
        ["quadratic","Quadratic formula",["ax² + bx + c = 0","Δ = b² − 4ac","x = (−b ± √Δ)/(2a)"],"a ≠ 0. The sign of Δ determines whether there are two, one or zero distinct real roots."],
        ["two-equations","Two linear equations",["ax + by = e","cx + dy = f","D = ad − bc","x = (ed − bf)/D,  y = (af − ec)/D"],"These solutions require D ≠ 0."]
      ]],
      ["Analytic geometry", [
        ["distance","Distance, slope and midpoint",["d = √[(x₂ − x₁)² + (y₂ − y₁)²]","m = (y₂ − y₁)/(x₂ − x₁)","M = ((x₁ + x₂)/2, (y₁ + y₂)/2)"],"The slope m is defined when x₂ ≠ x₁."],
        ["coordinate-circle","Coordinate equations",["Line: y − y₁ = m(x − x₁)","Circle: (x − h)² + (y − k)² = r²"],"The circle has centre (h, k) and radius r."]
      ]],
      ["Derivatives", [
        ["derivative-rules","Differentiation rules",["(xⁿ)′ = nxⁿ⁻¹","(fg)′ = f′g + fg′","(f/g)′ = (f′g − fg′)/g²","(f ∘ g)′(x) = f′(g(x))g′(x)"],"Use the quotient rule where g ≠ 0."],
        ["derivative-functions","Common derivatives",["(sin x)′ = cos x","(cos x)′ = −sin x","(eˣ)′ = eˣ","(ln x)′ = 1/x"],"Trigonometric arguments are in radians. For ln x, x > 0."]
      ]],
      ["Integration", [
        ["antiderivatives","Common antiderivatives",["∫ xⁿ dx = xⁿ⁺¹/(n + 1) + C","∫ (1/x) dx = ln|x| + C","∫ eˣ dx = eˣ + C","∫ cos x dx = sin x + C"],"The power rule requires n ≠ −1. C is the constant of integration."],
        ["integration-rules","Integration by parts and definite integrals",["∫ u dv = uv − ∫ v du","∫ₐᵇ f(x) dx = F(b) − F(a)"],"F is an antiderivative of f. The definite-integral formula holds, for example, when f is continuous on [a, b]."]
      ]],
      ["Matrices", [
        ["matrix-inverse","2 × 2 determinant and inverse",["A = [[a, b], [c, d]]","det A = ad − bc","A⁻¹ = [[d, −b], [−c, a]] / det A"],"The inverse exists only when det A ≠ 0."]
      ]],
      ["Unit conversion", [
        ["conversions","Length, speed and temperature",["1 km = 1,000 m","1 m/s = 3.6 km/h","T(K) = T(°C) + 273.15","T(°F) = ⁹⁄₅ T(°C) + 32"],"These temperature formulas convert readings on the scales."]
      ]],
      ["Statistics", [
        ["mean-variance","Mean and sample variance",["x̄ = (Σ xᵢ)/n","s² = Σ(xᵢ − x̄)²/(n − 1)","s = √s²"],"n > 1 for sample variance. s is sample standard deviation."],
        ["probability","Probability and standardisation",["P(A | B) = P(A ∩ B)/P(B)","z = (x − μ)/σ"],"The first formula requires P(B) > 0, the second requires σ > 0."]
      ]],
      ["Transforms", [
        ["laplace","Laplace transform",["ℒ{f}(s) = ∫₀^∞ e⁻ˢᵗ f(t) dt","ℒ{1}(s) = 1/s","ℒ{eᵃᵗ}(s) = 1/(s − a)"],"For real a, the example transforms converge for Re(s) > 0 and Re(s) > a, respectively."],
        ["fourier","Fourier transform",["F(ω) = ∫ f(t)e^(−iωt) dt","f(t) = (1/2π) ∫ F(ω)e^(iωt) dω"],"Both integrals are over the real line. This angular-frequency convention uses ω in rad/s when t is time."]
      ]]
    ],
    physics: [
      ["Mechanics", [
        ["kinematics","Constant acceleration",["v = u + at","Δx = ut + ½at²","v² = u² + 2aΔx"],"For one-dimensional motion with constant acceleration a (the SUVAT equations). u and v are signed initial and final velocities."],
        ["force","Force, momentum and impulse",["ΣF = ma","p = mv","J = Δp = Fₙₑₜ Δt"],"These are vector relationships. The last equality assumes constant net force."],
        ["energy","Work, energy and power",["W = Fd cos θ","K = ½mv²","ΔU = mgΔh","P = W/Δt"],"Work uses a constant force at angle θ to the displacement. Gravitational acceleration g is approximately constant for the potential-energy formula. P is average power."],
        ["gravity","Gravity and circular motion",["F = Gm₁m₂/r²","aᶜ = v²/r = ω²r"],"F is the magnitude of the attraction between point masses. aᶜ is centripetal acceleration."]
      ]],
      ["Electricity", [
        ["ohm","Ohm’s law and electrical power",["V = IR","P = VI","P = I²R = V²/R"],"Ohm’s law uses an ohmic resistor. The last equality follows for a resistor with R > 0."],
        ["circuits","Series and parallel resistors",["Rₛ = Σ Rᵢ","1/Rₚ = Σ (1/Rᵢ)"],"Series resistors share current. Parallel resistors share voltage."],
        ["capacitor","Capacitance and stored energy",["Q = CV","U = ½CV²"],"Q is charge magnitude and C is capacitance."]
      ]],
      ["Thermal physics", [
        ["heat","Heating and phase changes",["Q = mcΔT","Q = mL"],"Use specific heat c within a phase and specific latent heat L for a phase change."],
        ["ideal-gas","Ideal gas and first law",["pV = nRT","ΔU = Q − W"],"T is absolute temperature in kelvins. Here Q is heat added and W is work done by the system."]
      ]],
      ["Periodic motion", [
        ["oscillation","Spring and pendulum periods",["T = 2π√(m/k)","T ≈ 2π√(ℓ/g)"],"The first is for an ideal mass–spring oscillator. The pendulum result assumes a small swing angle."],
        ["waves","Waves and frequency",["v = fλ","T = 1/f","ω = 2πf"],"λ is wavelength, T is period and ω is angular frequency."]
      ]],
      ["Optics", [
        ["snell","Refraction and critical angle",["n₁ sin θ₁ = n₂ sin θ₂","θᶜ = arcsin(n₂/n₁)"],"Measure the angles from the normal. A critical angle exists when n₁ > n₂."],
        ["lenses","Thin lenses and magnification",["1/f = 1/dₒ + 1/dᵢ","m = −dᵢ/dₒ"],"Use the real-is-positive convention for object and image distances. f is positive for converging lenses."]
      ]],
      ["Atomic physics", [
        ["photon","Photons and matter waves",["E = hf = hc/λ","λ = h/p"],"The photon wavelength in E = hc/λ is in vacuum. The second equation is the de Broglie relation for momentum p."],
        ["decay","Radioactive decay",["N(t) = N₀e^(−λt)","t½ = ln(2)/λ"],"λ is the decay constant and t½ is the half-life."]
      ]],
      ["Constants", [
        ["si-constants","Exact SI constants",["c = 299,792,458 m/s","h = 6.62607015 × 10⁻³⁴ J·s","e = 1.602176634 × 10⁻¹⁹ C","k = 1.380649 × 10⁻²³ J/K","Nₐ = 6.02214076 × 10²³ mol⁻¹"],"Speed of light in vacuum, Planck constant, elementary charge, Boltzmann constant and Avogadro constant."]
      ]]
    ]
  };
  const titles = {maths:'Maths', physics:'Physics'};
  const $ = id => document.getElementById(id);
  const dialog = $('scientificMenu'), settings = $('scientificMenuSettings'), reference = $('formulaReference');
  const launch = $('openFormulaReference'), back = $('backFromFormulaReference'), search = $('formulaSearch');
  const results = $('formulaTopics'), status = $('formulaStatus');
  const tabs = Array.from(reference.querySelectorAll('[data-formula-subject]'));
  const storageKey = 'gregle-calc-formula-favourites';
  let favourites = new Set();
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(saved)) favourites = new Set(saved.filter(id => typeof id === 'string'));
  } catch (_) {}
  let subject = 'maths';

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function triangle() {
    const diagram = element('canvas','formula-diagram');
    diagram.width = 520;
    diagram.height = 272;
    diagram.setAttribute('role','img');
    diagram.setAttribute('aria-label','Triangle with sides a, b and c, and altitude h perpendicular to base b.');
    const pen = diagram.getContext('2d');
    if (!pen) return diagram;
    pen.scale(2,2);
    pen.strokeStyle = pen.fillStyle = '#263849';
    pen.lineWidth = 1.8;
    pen.beginPath();
    pen.moveTo(42,104);
    pen.lineTo(91,22);
    pen.lineTo(225,104);
    pen.closePath();
    pen.stroke();
    pen.lineWidth = 1;
    pen.setLineDash([4,3]);
    pen.beginPath();
    pen.moveTo(91,22);
    pen.lineTo(91,104);
    pen.stroke();
    pen.setLineDash([]);
    pen.beginPath();
    pen.moveTo(91,95);
    pen.lineTo(100,95);
    pen.lineTo(100,104);
    pen.stroke();
    pen.font = 'italic 16px Georgia, serif';
    pen.fillText('a',56,58);
    pen.fillText('b',128,123);
    pen.fillText('c',166,62);
    pen.fillText('h',101,74);
    return diagram;
  }

  function card([id,title,equations,note]) {
    const article = element('article','formula-card');
    const heading = element('div','formula-card-heading');
    const star = element('button','formula-star');
    star.type = 'button';
    function updateStar() {
      const saved = favourites.has(id);
      star.textContent = saved ? '★' : '☆';
      star.setAttribute('aria-pressed',String(saved));
      star.setAttribute('aria-label',saved ? 'Remove '+title+' from favourites' : 'Add '+title+' to favourites');
    }
    updateStar();
    star.addEventListener('click',() => {
      if (favourites.has(id)) favourites.delete(id);
      else favourites.add(id);
      try {localStorage.setItem(storageKey,JSON.stringify([...favourites]));} catch (_) {}
      if (subject === 'favourites') {
        render();
        (results.querySelector('.formula-star') || tabs.find(tab => tab.dataset.formulaSubject === subject)).focus();
      } else updateStar();
    });
    heading.append(element('h3','',title),star);
    article.append(heading);
    if (id === 'triangle') article.append(triangle());
    const list = element('ul','formula-equations');
    const rendered = window.GregleFormulaMath?.[id];
    equations.forEach((equation,index) => {
      const row = element('li');
      // Markup is generated from the bundled LaTeX source at build time.
      if (rendered?.[index]) row.innerHTML = rendered[index];
      else row.textContent = equation;
      list.append(row);
    });
    article.append(list,element('p','formula-note',note));
    return article;
  }

  const normalise = value => value.normalize('NFKD').replace(/[’']/g,'').toLowerCase();
  function render() {
    const words = normalise(search.value).trim().split(/\s+/).filter(Boolean);
    const subjects = subject === 'favourites' ? Object.keys(catalogue) : [subject];
    const sections = document.createDocumentFragment();
    let count = 0;
    for (const name of subjects) {
      for (const [topic,entries] of catalogue[name]) {
        const matches = entries.filter(([id,title,equations,note]) => {
          if (subject === 'favourites' && !favourites.has(id)) return false;
          const haystack = normalise([titles[name],topic,title,...equations,note].join(' '));
          return words.every(word => haystack.includes(word));
        });
        if (!matches.length) continue;
        const group = element('details','formula-topic');
        group.open = words.length > 0 || subject === 'favourites';
        const label = subject === 'favourites' ? titles[name]+' · '+topic : topic;
        const summary = element('summary','',label);
        summary.append(element('span','formula-count',String(matches.length)));
        group.append(summary,...matches.map(card));
        sections.append(group);
        count += matches.length;
      }
    }
    results.replaceChildren(sections);
    status.textContent = count ? '' : (words.length ? 'No matching formulas.' : 'Save a formula with its star to see it here.');
  }

  function showReference(open) {
    settings.hidden = open;
    reference.hidden = !open;
    dialog.classList.toggle('formulas-open',open);
    dialog.scrollTop = 0;
  }

  launch.addEventListener('click',() => {
    showReference(true);
    render();
    back.focus({preventScroll:true});
  });
  back.addEventListener('click',() => {
    showReference(false);
    launch.focus({preventScroll:true});
  });
  dialog.addEventListener('close',() => showReference(false));
  for (const tab of tabs) tab.addEventListener('click',() => {
    subject = tab.dataset.formulaSubject;
    for (const button of tabs) button.setAttribute('aria-pressed',String(button === tab));
    render();
  });
  search.addEventListener('input',render);
  search.addEventListener('keydown',event => {if (event.key === 'Enter') event.preventDefault();});
})();
