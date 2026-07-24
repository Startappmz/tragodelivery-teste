/* ============================================
   Trago Delivery - Glass Admin Theme
   Based on TemplateMo Glass Admin
   CORREÇÃO DEFINITIVA DO MENU MOBILE
============================================ */

(function() {
    'use strict';

    // ============================================
    // Theme Toggle
    // ============================================
    function initThemeToggle() {
        const themeToggle = document.getElementById('theme-toggle');
        if (!themeToggle) return;

        const iconSun = themeToggle.querySelector('.icon-sun');
        const iconMoon = themeToggle.querySelector('.icon-moon');
        
        function setTheme(theme) {
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem('theme', theme);
            
            if (iconSun && iconMoon) {
                if (theme === 'light') {
                    iconSun.style.display = 'none';
                    iconMoon.style.display = 'block';
                } else {
                    iconSun.style.display = 'block';
                    iconMoon.style.display = 'none';
                }
            }
        }
        
        const savedTheme = localStorage.getItem('theme') || 'light';
        setTheme(savedTheme);
        
        themeToggle.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            setTheme(currentTheme === 'dark' ? 'light' : 'dark');
        });
    }

    // ============================================
    // 3D Tilt Effect
    // ============================================
    function initTiltEffect() {
        document.querySelectorAll('.glass-card-3d').forEach(card => {
            card.addEventListener('mousemove', (e) => {
                const rect = card.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                
                const centerX = rect.width / 2;
                const centerY = rect.height / 2;
                
                const rotateX = (y - centerY) / 20;
                const rotateY = (centerX - x) / 20;
                
                card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(10px)`;
            });
            
            card.addEventListener('mouseleave', () => {
                card.style.transform = 'perspective(1000px) rotateX(0) rotateY(0) translateZ(0)';
            });
        });
    }

    // ============================================
    // Mobile Menu Toggle - VERSÃO DEFINITIVA
    // ============================================
    function initMobileMenu() {
        // Admin menu
        const menuToggle = document.getElementById('mobile-menu-toggle');
        const sidebar = document.getElementById('sidebar');
        
        if (menuToggle && sidebar) {
            console.log('✅ Admin menu encontrado');
            
            // Remover event listeners antigos
            const newMenuToggle = menuToggle.cloneNode(true);
            menuToggle.parentNode.replaceChild(newMenuToggle, menuToggle);
            
            function setAdminMobileMenu(open) {
                document.body.classList.toggle('mobile-menu-open', open);
                newMenuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
                newMenuToggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
                document.body.style.overflow = open ? 'hidden' : '';
            }

            newMenuToggle.setAttribute('aria-expanded', 'false');
            newMenuToggle.setAttribute('aria-label', 'Abrir menu');

            newMenuToggle.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                console.log('🍔 Menu admin clicado');
                setAdminMobileMenu(!document.body.classList.contains('mobile-menu-open'));
            });

            // Fechar ao clicar fora
            document.addEventListener('click', function(e) {
                if (document.body.classList.contains('mobile-menu-open')) {
                    if (!sidebar.contains(e.target) && e.target !== newMenuToggle && !newMenuToggle.contains(e.target)) {
                        console.log('❌ Fechando menu admin');
                        setAdminMobileMenu(false);
                    }
                }
            });

            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape' && document.body.classList.contains('mobile-menu-open')) {
                    setAdminMobileMenu(false);
                }
            });
        } else {
            console.log('❌ Admin menu não encontrado');
        }

        // Driver menu
        const driverMenuToggle = document.getElementById('mobile-driver-menu-toggle');
        const driverMobileMenu = document.getElementById('driver-mobile-nav');
        
        if (driverMenuToggle && driverMobileMenu) {
            console.log('✅ Driver menu encontrado');
            
            const newDriverToggle = driverMenuToggle.cloneNode(true);
            driverMenuToggle.parentNode.replaceChild(newDriverToggle, driverMenuToggle);
            
            newDriverToggle.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                console.log('🍔 Menu driver clicado');
                driverMobileMenu.classList.toggle('open');
            });

            document.addEventListener('click', function(e) {
                if (driverMobileMenu.classList.contains('open')) {
                    if (!driverMobileMenu.contains(e.target) && e.target !== newDriverToggle && !newDriverToggle.contains(e.target)) {
                        console.log('❌ Fechando menu driver');
                        driverMobileMenu.classList.remove('open');
                    }
                }
            });
        } else {
            console.log('❌ Driver menu não encontrado');
        }
    }

    // ============================================
    // Form Validation
    // ============================================
    function initFormValidation() {
        const forms = document.querySelectorAll('form[data-validate]');
        
        forms.forEach(form => {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                
                let isValid = true;
                const inputs = form.querySelectorAll('.form-input[required], input[required], select[required]');
                
                inputs.forEach(input => {
                    if (!input.value.trim()) {
                        isValid = false;
                        input.style.borderColor = 'var(--danger)';
                    } else {
                        input.style.borderColor = '';
                    }
                });

                if (isValid) {
                    console.log('Form is valid');
                    if (form.dataset.redirect) {
                        window.location.href = form.dataset.redirect;
                    }
                }
            });
        });
    }

    // ============================================
    // Smooth Page Transitions
    // ============================================
    function initPageTransitions() {
        const links = document.querySelectorAll('a[href$=".html"]:not([target="_blank"])');
        
        links.forEach(link => {
            if (link.hostname !== window.location.hostname && link.hostname !== '') return;
            
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const href = link.getAttribute('href');
                
                document.body.style.opacity = '0';
                document.body.style.transition = 'opacity 0.3s ease';
                
                setTimeout(() => {
                    window.location.href = href;
                }, 300);
            });
        });

        window.addEventListener('load', () => {
            document.body.style.opacity = '1';
        });
    }

    // ============================================
    // Initialize All Functions
    // ============================================
    function init() {
        console.log('🚀 Inicializando scripts...');
        initThemeToggle();
        initTiltEffect();
        
        // Pequeno delay para garantir que o DOM está completamente carregado
        setTimeout(() => {
            initMobileMenu();
        }, 100);
        
        initFormValidation();
        initPageTransitions();
        console.log('✅ Scripts inicializados');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();