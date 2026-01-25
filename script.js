document.addEventListener('DOMContentLoaded', () => {
    // Reveal Animation on Scroll
    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
            }
        });
    }, {
        threshold: 0.1
    });

    const hiddenElements = document.querySelectorAll('.reveal');
    hiddenElements.forEach((el) => observer.observe(el));

    // Mobile Menu Logic
    const mobileBtn = document.getElementById('mobile-menu-btn');
    const mobileMenu = document.getElementById('mobile-menu');

    if (mobileBtn && mobileMenu) {
        mobileBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            mobileMenu.classList.toggle('hidden');

            // Icon transition (optional, if you want to change bars to times)
            const icon = mobileBtn.querySelector('i');
            if (icon.classList.contains('fa-bars')) {
                icon.classList.remove('fa-bars');
                icon.classList.add('fa-times');
            } else {
                icon.classList.remove('fa-times');
                icon.classList.add('fa-bars');
            }
        });

        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!mobileMenu.contains(e.target) && !mobileBtn.contains(e.target)) {
                mobileMenu.classList.add('hidden');
                const icon = mobileBtn.querySelector('i');
                icon.classList.remove('fa-times');
                icon.classList.add('fa-bars');
            }
        });
    }

    // Mobile Accordion Logic
    const dropdownBtns = document.querySelectorAll('.mobile-dropdown-btn');

    dropdownBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const content = btn.nextElementSibling;
            const icon = btn.querySelector('i');

            // Toggle current dropdown
            content.classList.toggle('hidden');
            icon.classList.toggle('rotate-180');

            // Optional: Close other dropdowns
            // dropdownBtns.forEach(otherBtn => {
            //     if (otherBtn !== btn) {
            //         otherBtn.nextElementSibling.classList.add('hidden');
            //         otherBtn.querySelector('i').classList.remove('rotate-180');
            //     }
            // });
        });
    });
});
