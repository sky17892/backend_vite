import axios from 'axios';

const fetchBtn = document.getElementById('fetch-btn') as HTMLButtonElement;
const userList = document.getElementById('user-list') as HTMLUListElement;

fetchBtn.addEventListener('click', async () => {
  try {
    const response = await axios.get('/api/users');
    const users = response.data;

    userList.innerHTML = '';
    users.forEach((user: { id: number; email: string; name?: string }) => {
      const li = document.createElement('li');
      li.textContent = `${user.id}: ${user.name || '이름 없음'} (${user.email})`;
      userList.appendChild(li);
    });
  } catch (error) {
    console.error('데이터 로드 실패:', error);
  }
});