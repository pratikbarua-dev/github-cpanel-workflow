document.addEventListener('DOMContentLoaded', () => {
    // Smooth scrolling for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;

            e.preventDefault();
            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                targetElement.scrollIntoView({
                    behavior: 'smooth'
                });
            }
        });
    });

    // Mobile Menu Toggle Logic
    const menuBtn = document.querySelector('.fa-bars')?.parentElement;
    const nav = document.querySelector('nav');

    if (menuBtn && nav) {
        menuBtn.addEventListener('click', () => {
            nav.classList.toggle('hidden');
            nav.classList.toggle('flex');
            nav.classList.toggle('flex-col');
            nav.classList.toggle('absolute');
            nav.classList.toggle('top-[70px]'); // Adjusted height
            nav.classList.toggle('left-0');
            nav.classList.toggle('w-full');
            nav.classList.toggle('bg-white');
            nav.classList.toggle('p-6');
            nav.classList.toggle('shadow-lg');
            nav.classList.toggle('z-50'); // Ensure it's on top
        });
    }

    // Mobile Dropdown Interactions
    // On mobile, clicking the parent button should toggle the submenu
    const dropdownToggles = document.querySelectorAll('nav .group > button');

    dropdownToggles.forEach(toggle => {
        toggle.addEventListener('click', (e) => {
            // Check if we are in mobile view (nav is flex-col)
            if (nav.classList.contains('flex-col')) {
                e.preventDefault();
                const dropdown = toggle.nextElementSibling;
                const icon = toggle.querySelector('.fa-chevron-down');

                // Toggle visibility classes
                // We need to override the desktop hover behavior
                if (dropdown.classList.contains('invisible')) {
                    // Show
                    dropdown.classList.remove('invisible', 'opacity-0', 'absolute');
                    dropdown.classList.add('visible', 'opacity-100', 'relative', 'pl-4');
                    if (icon) icon.style.transform = 'rotate(180deg)';
                } else {
                    // Hide
                    dropdown.classList.add('invisible', 'opacity-0', 'absolute');
                    dropdown.classList.remove('visible', 'opacity-100', 'relative', 'pl-4');
                    if (icon) icon.style.transform = 'rotate(0deg)';
                }
            }
        });
    });

    // Scroll Animation Observer (Moved from inline script)
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.1
    };

    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    const elementsToReveal = document.querySelectorAll('.reveal');
    elementsToReveal.forEach(el => observer.observe(el));
});