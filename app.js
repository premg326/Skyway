const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const today=new Date(), depart=$('#departDate'), ret=$('#returnDate');
const dateInput=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const fmtDate=d=>{const x=new Date(`${d}T12:00:00`);return x.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})};
today.setDate(today.getDate()+14);depart.min=dateInput(new Date());depart.value=dateInput(today);
const returnDefault=new Date(today);returnDefault.setDate(returnDefault.getDate()+7);ret.min=depart.value;ret.value=dateInput(returnDefault);
$('#copyrightYear').textContent=new Date().getFullYear();
let tripType='roundtrip',flights=[],account=null,toastTimer,multiRows=[];

function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function toast(message){const t=$('#toast');t.textContent=message;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),3600)}
async function api(path,{method='GET',data}={}){
  const options={method,credentials:'same-origin',headers:{'accept':'application/json'}};
  if(data!==undefined){options.headers['content-type']='application/json';options.body=JSON.stringify(data)}
  const response=await fetch(path,options);let payload={};try{payload=await response.json()}catch{}
  if(!response.ok){const error=Error(payload.error||`Request failed (${response.status}).`);error.status=response.status;throw error}
  return payload;
}
function showModal(markup,wide=false){$('.modal').classList.toggle('modal-wide',wide);$('#modalContent').innerHTML=markup;$('#bookingModal').classList.remove('hidden')}
function closeModal(){$('#bookingModal').classList.add('hidden')}
function code(s){const m=String(s??'').match(/\(([^)]+)\)/);return m?m[1]:String(s??'').slice(0,3).toUpperCase()}
function currency(c){return ({USD:'$',EUR:'€',GBP:'£',INR:'₹'})[c]||`${c||'USD'} `}
function updateHeader(){const button=$('#signInBtn');button.innerHTML=account?`<span class="user-icon">◉</span> ${esc(account.first_name)}`:'<span class="user-icon">◉</span> Sign in';button.setAttribute('aria-label',account?'Open my account':'Sign in')}
async function loadAccount(){try{const data=await api('/api/auth/me');account=data.account||null}catch{account=null}updateHeader()}

function setTrip(type){
  tripType=type;$$('.trip-tab').forEach(b=>b.classList.toggle('selected',b.dataset.trip===type));
  const multi=type==='multicity';$('.return-field').classList.toggle('hidden',type!=='roundtrip');ret.required=type==='roundtrip';
  $('#multiCityLegs').classList.toggle('hidden',!multi);$('#addMultiCityLeg').classList.toggle('hidden',!multi);
  if(multi&&!multiRows.length){multiRows=[{from:'',to:'',date:''}];drawMultiLegs()}
  if(!multi){multiRows=[];$('#multiCityLegs').innerHTML=''}
}
$$('.trip-tab').forEach(b=>b.addEventListener('click',()=>setTrip(b.dataset.trip)));
depart.addEventListener('change',()=>{ret.min=depart.value;if(ret.value<depart.value)ret.value=depart.value;drawMultiLegs()});
$('#destination').addEventListener('input',()=>drawMultiLegs());
$('#swapBtn').addEventListener('click',()=>{const a=$('#origin'),b=$('#destination');[a.value,b.value]=[b.value,a.value];drawMultiLegs()});
function drawMultiLegs(){
  if(tripType!=='multicity')return;
  $('#multiCityLegs').innerHTML=multiRows.map((leg,i)=>`<div class="multi-city-leg"><div class="multi-city-title">FLIGHT ${i+2}</div><label>FROM<input data-multi-from="${i}" value="${esc(leg.from||(i===0?$('#destination').value:multiRows[i-1].to))}" placeholder="Airport or city" required></label><label>TO<input data-multi-to="${i}" value="${esc(leg.to)}" placeholder="Where to?" required></label><label>DEPART<input data-multi-date="${i}" type="date" min="${esc(i===0?depart.value:(multiRows[i-1].date||depart.value))}" value="${esc(leg.date)}" required></label>${i>0?`<button type="button" class="remove-leg" data-remove-leg="${i}" aria-label="Remove flight ${i+2}">×</button>`:''}</div>`).join('');
  $$('[data-multi-from]').forEach(el=>el.addEventListener('input',()=>multiRows[Number(el.dataset.multiFrom)].from=el.value));
  $$('[data-multi-to]').forEach(el=>el.addEventListener('input',()=>multiRows[Number(el.dataset.multiTo)].to=el.value));
  $$('[data-multi-date]').forEach(el=>el.addEventListener('change',()=>multiRows[Number(el.dataset.multiDate)].date=el.value));
  $$('[data-remove-leg]').forEach(el=>el.addEventListener('click',()=>{multiRows.splice(Number(el.dataset.removeLeg),1);drawMultiLegs()}));
}
$('#addMultiCityLeg').addEventListener('click',()=>{if(multiRows.length>=3){toast('Multi-city trips support up to four flight legs.');return}multiRows.push({from:'',to:'',date:''});drawMultiLegs()});

$('#searchForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const q={origin:$('#origin').value.trim(),destination:$('#destination').value.trim(),depart_date:depart.value,return_date:tripType==='roundtrip'?ret.value:'',passengers:$('#passengers').value,cabin:$('#cabin').value,trip_type:tripType};
  if(tripType==='multicity'){
    const segments=[{origin:q.origin,destination:q.destination,depart_date:q.depart_date},...multiRows.map((r,i)=>({origin:$(`[data-multi-from="${i}"]`)?.value.trim()||r.from||($('#destination').value.trim()),destination:$(`[data-multi-to="${i}"]`)?.value.trim()||r.to,depart_date:$(`[data-multi-date="${i}"]`)?.value||r.date}))];
    if(segments.length<2||segments.some(s=>!s.origin||!s.destination||!s.depart_date)){toast('Complete each flight leg before searching.');return}
    if(segments.some(s=>code(s.origin)===code(s.destination))){toast('Each leg needs different origin and destination airports.');return}
    if(segments.some((s,i)=>i>0&&s.depart_date<segments[i-1].depart_date)){toast('Multi-city dates must follow the leg order.');return}
    q.segments=segments;q.origin=segments[0].origin;q.destination=segments.at(-1).destination;
  }
  if(!q.destination){$('#destination').focus();return}
  if(q.return_date&&q.return_date<q.depart_date){toast('Return date must be after your departure.');return}
  $('#flightList').innerHTML='<div class="empty-state">Finding sample fares…</div>';$('#results').classList.remove('hidden');
  $('#resultDestination').textContent=q.destination.split(' (')[0];
  $('#resultsMeta').textContent=`${q.origin.split(' (')[0]} → ${q.destination.split(' (')[0]} · ${fmtDate(q.depart_date)}${q.return_date?` — ${fmtDate(q.return_date)}`:''} · ${q.passengers} traveler${q.passengers==='1'?'':'s'} · ${q.cabin}${q.trip_type==='multicity'?' · Multi-city':''}`;
  $('#results').scrollIntoView({behavior:'smooth',block:'start'});
  try{const result=await api('/api/search',{method:'POST',data:q});flights=result.flights||[]}
  catch(error){flights=makeDemoFlights(q);toast(`${error.message} Showing preview fares.`)}
  renderFlights(q);loadFlexibleDates(q);
});
let flexDateRequest=0;
async function loadFlexibleDates(q){
  const panel=$('#flexDatePanel'),options=$('#flexDateOptions'),request=++flexDateRequest;
  if(q.trip_type==='multicity'){panel.classList.add('hidden');return}
  panel.classList.remove('hidden');options.innerHTML='<div class="flex-date-loading">Comparing seven nearby dates…</div>';
  try{
    const result=await api('/api/flexible-dates',{method:'POST',data:q});if(request!==flexDateRequest)return;
    const fares=result.fares||[];if(!fares.length){panel.classList.add('hidden');return}
    options.innerHTML=fares.map(fare=>{const d=new Date(`${fare.depart_date}T12:00:00`),label=d.toLocaleDateString('en-US',{weekday:'short'}),dateLabel=d.toLocaleDateString('en-US',{month:'short',day:'numeric'}),selected=fare.depart_date===q.depart_date;return `<button type="button" class="flex-date-card ${fare.is_lowest?'is-lowest':''} ${selected?'is-selected':''}" data-flex-depart="${esc(fare.depart_date)}" data-flex-return="${esc(fare.return_date)}" aria-label="Select ${label}, ${dateLabel}, total ${currency(fare.currency)}${Number(fare.total).toLocaleString()} for ${q.passengers} traveler${q.passengers==='1'?'':'s'}"><span class="flex-date-day">${esc(label)}</span><strong>${esc(dateLabel)}</strong><span class="flex-date-price">${currency(fare.currency)}${Number(fare.total).toLocaleString()}</span>${fare.is_lowest?'<span class="flex-date-best">LOWEST</span>':''}</button>`}).join('');
  }catch{if(request===flexDateRequest)panel.classList.add('hidden')}
}
$('#flexDateOptions').addEventListener('click',event=>{const card=event.target.closest('[data-flex-depart]');if(!card)return;depart.value=card.dataset.flexDepart;if(tripType==='roundtrip')ret.value=card.dataset.flexReturn;depart.dispatchEvent(new Event('change'));$('#searchForm').requestSubmit()});
function makeDemoFlights(q){return ['Northstar Air','Juniper Airways','Atlas Airlines'].map((name,i)=>({id:`demo-${i+1}`,airline:name,flight_number:['NS 204','JA 718','AT 931'][i],origin:q.origin,destination:q.destination,departure_time:['08:15','11:40','17:25'][i],arrival_time:['16:05','19:30','01:10'][i],duration:['6h 50m','6h 50m','6h 45m'][i],stops:i===1?'1 stop':'Nonstop',price:[489,552,624][i],currency:'USD',cabin:q.cabin}))}
function timeLabel(value){const raw=String(value??'');const match=raw.match(/(?:T|\s)(\d{2}:\d{2})/);return match?match[1]:raw}
function renderFlights(q){
  const list=$('#flightList');if(!flights.length){list.innerHTML='<div class="empty-state">No sample flights found. Try another date or route.</div>';return}
  if(q.trip_type==='multicity'){
    list.innerHTML=flights.map((f,i)=>`<article class="flight-card multi-result"><div class="multi-result-head"><div class="airline">${esc(f.airline)}<small>${esc(f.flight_number)} · Multi-city demo fare</small></div><div class="price-block"><strong>${currency(f.currency)}${Number(f.price).toLocaleString()}</strong><small>per traveler</small></div></div><div class="multi-result-legs">${(f.legs||[]).map((leg,j)=>`<div class="multi-result-leg"><span class="leg-index">${j+1}</span><div><strong>${esc(leg.origin)} → ${esc(leg.destination)}</strong><small>${fmtDate(leg.departure_time.slice(0,10))} · ${esc(timeLabel(leg.departure_time))} · ${esc(leg.duration)} · ${esc(leg.stops)}</small></div></div>`).join('')}</div><button class="book-btn" data-flight="${i}">Continue</button></article>`).join('');
  }else{
    list.innerHTML=flights.map((f,i)=>`<article class="flight-card"><div class="airline">${esc(f.airline)}<small>${esc(f.flight_number||'Flight')} · ${esc(f.stops||'Nonstop')}</small></div><div class="flight-route"><div class="time-block"><strong>${esc(timeLabel(f.departure_time))}</strong><small>${esc(code(f.origin||q.origin))}</small></div><div><div class="duration">${esc(f.duration||'Direct')}</div><div class="route-line"></div></div><div class="time-block"><strong>${esc(timeLabel(f.arrival_time))}</strong><small>${esc(code(f.destination||q.destination))}</small></div></div><div class="price-block"><strong>${currency(f.currency||'USD')}${Number(f.price).toLocaleString()}</strong><small>per traveler</small></div><button class="book-btn" data-flight="${i}">Select flight</button></article>`).join('');
  }
  $$('.book-btn').forEach(b=>b.addEventListener('click',()=>openBooking(flights[Number(b.dataset.flight)],q)));
}

function openBooking(f,q){
  const count=Number(q.passengers),base=Number(f.price)||Number(f.legs?.reduce((sum,l)=>sum+Number(l.price),0)||0),total=base*count*(q.trip_type==='roundtrip'?1.82:1);
  const segmentSummary=f.legs?.map((leg,i)=>`<div>${i+1}. ${esc(leg.origin)} → ${esc(leg.destination)} · ${fmtDate(leg.departure_time.slice(0,10))}</div>`).join('')||`${esc(f.departure_time)} ${esc(code(q.origin))} → ${esc(f.arrival_time)} ${esc(code(q.destination))} · ${fmtDate(q.depart_date)}`;
  const prefill=account?`value="${esc(account.first_name)}"`:'';
  const travelerFields=Array.from({length:count},(_,i)=>`<div class="traveler-panel"><h3>Traveler ${i+1}${i===0?' · primary':''}</h3><div class="booking-fields"><label>First name<input name="first_name_${i}" autocomplete="${i===0?'given-name':'off'}" ${i===0?prefill:''} required></label><label>Last name<input name="last_name_${i}" autocomplete="${i===0?'family-name':'off'}" ${i===0&&account?`value="${esc(account.last_name)}"`:''} required></label></div></div>`).join('');
  showModal(`<div class="eyebrow dark-eyebrow">DEMO BOOKING</div><h2 id="modalTitle">Review your trip</h2><p>This prototype uses sample fares. Confirming creates a demo booking record; it does not charge you or issue an airline ticket.</p><div class="modal-flight"><strong>${esc(f.airline)} · ${esc(f.flight_number||'Multi-city itinerary')}</strong>${segmentSummary}<hr><b>${currency(f.currency||'USD')}${total.toLocaleString()}</b> estimated demo total · ${count} traveler${count===1?'':'s'} · ${esc(q.cabin)}</div><form id="bookingForm"><div class="traveler-list">${travelerFields}</div><div class="booking-fields contact-fields"><label>Booking contact email<input name="email" type="email" autocomplete="email" value="${esc(account?.email||'')}" required></label><label>Phone number<input name="phone" type="tel" autocomplete="tel" value="${esc(account?.phone||'')}" required></label></div><label class="demo-consent"><input type="checkbox" name="demo_ack" required><span>I understand this is a demo booking. No payment will be taken and no ticket will be issued.</span></label><button class="confirm-btn">Confirm demo booking <span>→</span></button></form>`,true);
  $('#bookingForm').addEventListener('submit',async e=>{
    e.preventDefault();const form=e.currentTarget,button=form.querySelector('.confirm-btn');button.disabled=true;button.textContent='Confirming demo booking…';
    const fd=new FormData(form),travelers=Array.from({length:count},(_,i)=>({first_name:fd.get(`first_name_${i}`),last_name:fd.get(`last_name_${i}`)}));
    const payload={...q,flight:f,travelers,contact:{email:fd.get('email'),phone:fd.get('phone')}};
    try{const data=await api('/api/bookings',{method:'POST',data:payload});showConfirmation(data.booking,data.message,true)}
    catch(error){const ref=`PREVIEW-${Math.random().toString(36).slice(2,8).toUpperCase()}`;showConfirmation({reference:ref,status:'preview_only',trip_type:q.trip_type,depart_date:q.depart_date,return_date:q.return_date,passengers:count,total,currency:f.currency||'USD',contact:payload.contact,travelers,details:{flight:f,origin:q.origin,destination:q.destination}},`${error.message} This preview was not saved.`,false)}
  });
}
function statusLabel(status){return ({confirmed_demo:'Confirmed · demo',cancelled_demo:'Cancelled · demo',pending:'Pending'})[status]||status||'Unknown'}
function bookingRoute(booking){
  const details=booking.details||{},flight=details.flight||{};
  if(Array.isArray(flight.legs)&&flight.legs.length)return flight.legs.map((leg,i)=>`<div>${i+1}. ${esc(leg.origin)} → ${esc(leg.destination)} · ${fmtDate(String(leg.departure_time).slice(0,10))}</div>`).join('');
  return `${esc(details.origin||flight.origin||'Origin')} → ${esc(details.destination||flight.destination||'Destination')} · ${fmtDate(booking.depart_date||details.depart_date)}`;
}
function showConfirmation(b,message='Demo booking confirmed.',saved=true){
  showModal(`<div class="eyebrow dark-eyebrow">${saved?'DEMO BOOKING RECORDED':'PREVIEW ONLY'}</div><h2 id="modalTitle">${saved?'Your trip is confirmed in the demo.':'Booking preview'}</h2><p><strong>${esc(message)}</strong></p><div class="booking-confirm-card"><div class="booking-reference-label">BOOKING REFERENCE</div><div class="booking-reference">${esc(b.reference)}</div><span class="status-pill ${b.status==='cancelled_demo'?'status-cancelled':''}">${esc(statusLabel(b.status))}</span><div class="booking-confirm-route">${bookingRoute(b)}</div><div class="booking-confirm-meta">${Number(b.passengers)||1} traveler${Number(b.passengers)===1?'':'s'} · ${esc(b.cabin||'Economy')} · ${currency(b.currency)}${Number(b.total||0).toLocaleString()}</div></div><p class="demo-notice">No payment was collected and no airline ticket was issued. ${saved?(account?'This booking is linked to your account.':'Keep your reference and booking email to manage this trip.'):'Sign-in and booking storage are unavailable until the server connection returns.'}</p><div class="modal-actions"><button class="confirm-btn" id="manageConfirmed">Manage booking</button><button class="secondary-btn" id="doneBtn">Done</button></div>`,true);
  $('#manageConfirmed').addEventListener('click',()=>account?showAccount():showManage());$('#doneBtn').addEventListener('click',closeModal);
}

function authView(mode='login',message=''){
  const register=mode==='register';
  showModal(`<div class="eyebrow dark-eyebrow">YOUR SKYWAY ACCOUNT</div><h2 id="modalTitle">${register?'Create your account':'Welcome back'}</h2><p>Save traveler details and manage your demo bookings in one place.</p><div class="auth-tabs"><button type="button" data-auth-mode="login" class="${!register?'selected':''}">Sign in</button><button type="button" data-auth-mode="register" class="${register?'selected':''}">Create account</button></div>${message?`<div class="form-message" role="alert">${esc(message)}</div>`:''}<form id="authForm" data-mode="${register?'register':'login'}">${register?`<div class="booking-fields"><label>First name<input name="first_name" autocomplete="given-name" required></label><label>Last name<input name="last_name" autocomplete="family-name" required></label></div>`:''}<label class="stacked-label">Email address<input name="email" type="email" autocomplete="email" required></label>${register?`<label class="stacked-label">Phone number<input name="phone" type="tel" autocomplete="tel" required></label>`:''}<label class="stacked-label">Password<input name="password" type="password" autocomplete="${register?'new-password':'current-password'}" minlength="8" required></label>${register?'<small class="form-hint">Use at least 8 characters. This demo does not send verification or password-reset emails.</small>':''}<button class="confirm-btn">${register?'Create account':'Sign in'}</button></form>`,false);
  $$('[data-auth-mode]').forEach(b=>b.addEventListener('click',()=>authView(b.dataset.authMode)));
  $('#authForm').addEventListener('submit',async e=>{
    e.preventDefault();const form=e.currentTarget,fd=new FormData(form),register=form.dataset.mode==='register',data=Object.fromEntries(fd);
    try{const result=await api(`/api/auth/${register?'register':'login'}`,{method:'POST',data});account=result.account;updateHeader();toast(register?'Your Skyway account is ready.':'Welcome back.');showAccount()}
    catch(error){authView(register?'register':'login',error.message)}
  });
}
function bookingCard(b,guestEmail=''){
  const canCancel=b.status==='confirmed_demo';
  return `<article class="account-booking"><div class="account-booking-top"><strong>${esc(b.reference)}</strong><span class="status-pill ${b.status==='cancelled_demo'?'status-cancelled':''}">${esc(statusLabel(b.status))}</span></div><div class="account-booking-route">${bookingRoute(b)}</div><div class="account-booking-meta">${b.passengers} traveler${b.passengers===1?'':'s'} · ${esc(b.cabin)} · ${currency(b.currency)}${Number(b.total).toLocaleString()}</div><div class="account-booking-bottom"><small>${esc(guestEmail||b.contact?.email||'')}</small>${canCancel?`<button type="button" class="cancel-booking" data-ref="${esc(b.reference)}" data-email="${esc(guestEmail)}">Cancel demo booking</button>`:''}</div></article>`;
}
function attachCancelButtons(){
  $$('.cancel-booking').forEach(button=>button.addEventListener('click',async()=>{
    if(!window.confirm(`Cancel demo booking ${button.dataset.ref}?`))return;
    try{await api(`/api/bookings/${encodeURIComponent(button.dataset.ref)}/cancel`,{method:'POST',data:{email:button.dataset.email||account?.email||''}});toast('Demo booking cancelled.');account?showAccount():showManage()}
    catch(error){toast(error.message)}
  }));
}
async function showAccount(){
  if(!account){authView();return}
  let bookings=[];try{bookings=(await api('/api/bookings')).bookings||[]}catch(error){if(error.status===401){account=null;updateHeader();authView('login','Your demo sign-in has expired. Sign in again or create a new account. Free demo account data may reset after a service restart.');return}toast(error.message);return}
  const bookingList=bookings.length?bookings.map(b=>bookingCard(b)).join(''):'<div class="empty-state">No bookings yet. Search for a flight to get started.</div>';
  showModal(`<div class="eyebrow dark-eyebrow">MY SKYWAY</div><h2 id="modalTitle">Hello, ${esc(account.first_name)}.</h2><p>Your account bookings and traveler contact details.</p><form id="profileForm" class="profile-form"><div class="booking-fields"><label>First name<input name="first_name" value="${esc(account.first_name)}" required></label><label>Last name<input name="last_name" value="${esc(account.last_name)}" required></label></div><label class="stacked-label">Phone number<input name="phone" type="tel" value="${esc(account.phone||'')}"></label><div class="account-email">Account email: <strong>${esc(account.email)}</strong></div><button class="secondary-btn">Save profile</button></form><details class="password-panel"><summary>Change password</summary><form id="passwordForm"><label class="stacked-label">Current password<input name="current_password" type="password" autocomplete="current-password" required></label><label class="stacked-label">New password<input name="new_password" type="password" autocomplete="new-password" minlength="8" required></label><button class="secondary-btn">Update password</button></form></details><div class="account-section-heading"><h3>My bookings</h3><span>${bookings.length} total</span></div><div class="account-bookings-list">${bookingList}</div><div class="modal-actions"><button type="button" class="secondary-btn" id="manageGuest">Manage a booking</button><button type="button" class="signout-btn" id="signOut">Sign out</button></div>`,true);
  attachCancelButtons();
  $('#manageGuest').addEventListener('click',()=>showManage());
  $('#profileForm').addEventListener('submit',async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));try{const result=await api('/api/auth/profile',{method:'PATCH',data});account=result.account;updateHeader();toast('Profile updated.');showAccount()}catch(error){toast(error.message)}});
  $('#passwordForm').addEventListener('submit',async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));try{const result=await api('/api/auth/password',{method:'PATCH',data});toast(result.message);showAccount()}catch(error){toast(error.message)}});
  $('#signOut').addEventListener('click',async()=>{try{await api('/api/auth/logout',{method:'POST',data:{}})}catch{}account=null;updateHeader();toast('You are signed out.');authView()});
}
function showManage(){
  if(account){showAccount();return}
  showModal(`<div class="eyebrow dark-eyebrow">TRIP SUPPORT</div><h2 id="modalTitle">Manage your booking</h2><p>Enter the reference and contact email used at checkout. Demo bookings can be reviewed or cancelled here.</p><form id="lookupForm" class="lookup-form"><label class="stacked-label">Booking reference<input name="reference" placeholder="SKY-XXXXXXXX" autocomplete="off" required></label><label class="stacked-label">Booking email<input name="email" type="email" autocomplete="email" required></label><button class="confirm-btn">Find booking</button></form><div id="lookupResult"></div><button class="secondary-btn full-width" id="signInFromManage">Sign in to see account bookings</button>`,false);
  $('#lookupForm').addEventListener('submit',async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));$('#lookupResult').innerHTML='<div class="empty-state">Looking up booking…</div>';try{const result=await api('/api/bookings/lookup',{method:'POST',data});$('#lookupResult').innerHTML=bookingCard(result.booking,data.email);attachCancelButtons()}catch(error){$('#lookupResult').innerHTML=`<div class="form-message" role="alert">${esc(error.message)}</div>`}});
  $('#signInFromManage').addEventListener('click',()=>authView());
}

$('#signInBtn').addEventListener('click',async()=>{const wasSignedIn=!!account;await loadAccount();if(account)showAccount();else authView('login',wasSignedIn?'Your demo sign-in has expired. Sign in again or create a new account. Free demo account data may reset after a service restart.':'')});
$('#manageBtn').addEventListener('click',async()=>{const wasSignedIn=!!account;await loadAccount();if(wasSignedIn&&!account){authView('login','Your demo sign-in has expired. Sign in again or create a new account. Free demo account data may reset after a service restart.');return}showManage()});
const navLinks=$$('.main-nav a');
function setNavActive(link){navLinks.forEach(item=>item.classList.toggle('active',item===link));$('.main-nav').classList.remove('open')}
navLinks.forEach(link=>link.addEventListener('click',()=>{document.body.classList.toggle('explore-active',link.hash==='#explore');setNavActive(link)}));
if(location.hash==='#explore'){document.body.classList.add('explore-active');setNavActive($('.main-nav a[href="#explore"]'))}
$('#closeModal').addEventListener('click',closeModal);
$('#bookingModal').addEventListener('click',e=>{if(e.target.id==='bookingModal')closeModal()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
$('#editSearch').addEventListener('click',()=>$('#search').scrollIntoView({behavior:'smooth'}));
$$('.destination-card').forEach(c=>c.addEventListener('click',()=>{$('#destination').value=c.dataset.place;document.body.classList.remove('explore-active');setNavActive($('.main-nav a[href="#search"]'));setTrip('roundtrip');history.replaceState(null,'','#search');$('#searchForm').requestSubmit()}));
$('#menuBtn').addEventListener('click',()=>$('.main-nav').classList.toggle('open'));
$('#newsletterForm').addEventListener('submit',async e=>{e.preventDefault();const email=e.currentTarget.querySelector('input').value;try{const data=await api('/api/newsletter',{method:'POST',data:{email}});toast(data.message)}catch(error){toast(error.message)}e.currentTarget.reset()});
loadAccount();
