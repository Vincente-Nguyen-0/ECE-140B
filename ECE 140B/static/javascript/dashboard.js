document.addEventListener('DOMContentLoaded', () => {
    updateTime();
    setInterval(updateTime, 1000);

    initNavigation();
});

function updateTime() {
    const timeEl = document.getElementById('liveTime');
    if (timeEl) {
        const now = new Date();
        timeEl.textContent = now.toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    }
}

function toast(message) {
    const container = document.querySelector('.toast-container') || createToastContainer();
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<i class="fas fa-info-circle"></i> ${message}`;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slide-out 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function createToastContainer() {
    const container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
    return container;
}

function initNavigation() {
    document.querySelectorAll('.open-modal').forEach(btn => {
        btn.addEventListener('click', () => toast('Opening Add Umbrella modal...'));
    });

    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const action = e.currentTarget.getAttribute('data-action');
            if (action && !e.currentTarget.classList.contains('active')) {
                toast(`${action.charAt(0).toUpperCase() + action.slice(1)} coming soon.`);
            }
        });
    });

    const notifBtn = document.getElementById('notifBtn');
    if (notifBtn) {
        notifBtn.addEventListener('click', () => toast('You have 1 unread alert.'));
    }
}

function scrollToUmbrellas() {
    const grid = document.querySelector('.umbrellas-grid');
    if (grid) {
        grid.scrollIntoView({ behavior: 'smooth' });
    }
}