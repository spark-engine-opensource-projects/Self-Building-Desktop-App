const newDiv = document.createElement('div');
newDiv.id = 'cookie-counter';
document.body.appendChild(newDiv);

const score = document.createElement('span');
score.innerText = '0';
newDiv.appendChild(score);

const button = document.createElement('button');
button.innerText = 'Click for a Cookie!';
button.addEventListener('click', () => {
  const currentScore = parseInt(document.getElementById('cookie-counter').innerText);
  document.getElementById('cookie-counter').innerText = currentScore + 1;
});
newDiv.appendChild(button);
