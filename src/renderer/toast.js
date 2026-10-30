'use strict';

const params = new URLSearchParams(location.search);
document.getElementById('toast').classList.add(params.get('kind') || 'info');
document.getElementById('message').textContent = params.get('message') || '';
document.getElementById('detail').textContent = params.get('detail') || '';
