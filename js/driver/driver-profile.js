/* Perfil premium do motorista: dados pessoais, viatura, documentos e perfil público. */
(function () {
  'use strict';

  const STORAGE_KEY = 'tragoDriverProfile';
  const PUBLIC_STORAGE_KEY = 'tragoDriverPublicProfile';
  const MAX_FILE_SIZE = 5 * 1024 * 1024;
  const PROFILE_FIELDS = [
    'name', 'phone', 'email', 'bio', 'vehicle_type', 'vehicle_plate',
    'vehicle_brand', 'vehicle_model', 'vehicle_color', 'vehicle_year',
    'license_number', 'license_expiry', 'license_category',
    'emergency_name', 'emergency_phone'
  ];

  let currentProfile = null;
  let pendingImages = {
    avatar_url: '',
    vehicle_photo_url: '',
    license_photo_url: ''
  };

  function defaultProfile() {
    const savedName = localStorage.getItem('driverName') || 'Motorista TraGo';
    return {
      name: savedName,
      phone: '',
      email: '',
      bio: 'Motorista parceiro TraGo, pronto para entregar com segurança.',
      avatar_url: '',
      vehicle_photo_url: '',
      license_photo_url: '',
      license_photo_ref: '',
      vehicle_type: 'mota',
      vehicle_plate: '',
      vehicle_brand: '',
      vehicle_model: '',
      vehicle_color: '',
      vehicle_year: '',
      license_number: '',
      license_expiry: '',
      license_category: 'A',
      emergency_name: '',
      emergency_phone: '',
      rating: 4.9,
      total_deliveries: 0,
      verified: true
    };
  }

  function normaliseProfile(source = {}) {
    const nested = source.profile && typeof source.profile === 'object' ? source.profile : {};
    const user = source.driver && typeof source.driver === 'object' ? source.driver : source;
    const vehicle = nested.vehicle && typeof nested.vehicle === 'object'
      ? nested.vehicle
      : (source.vehicle && typeof source.vehicle === 'object' ? source.vehicle : {});
    const merged = { ...defaultProfile(), ...nested, ...source };

    return {
      ...defaultProfile(),
      ...merged,
      name: user.name || user.nome || merged.name || defaultProfile().name,
      phone: user.phone || user.telefone || merged.phone || '',
      email: user.email || merged.email || '',
      avatar_url: merged.avatar_url || merged.avatarUrl || '',
      vehicle_photo_url: merged.vehicle_photo_url || merged.vehiclePhotoUrl || vehicle.photo_url || '',
      license_photo_url: merged.license_photo_url || '',
      license_photo_ref: merged.license_photo_ref || '',
      vehicle_type: merged.vehicle_type || vehicle.type || 'mota',
      vehicle_plate: merged.vehicle_plate || vehicle.plate || '',
      vehicle_brand: merged.vehicle_brand || vehicle.brand || '',
      vehicle_model: merged.vehicle_model || vehicle.model || '',
      vehicle_color: merged.vehicle_color || vehicle.color || '',
      vehicle_year: merged.vehicle_year || vehicle.year || '',
      rating: Number(merged.rating || 4.9),
      total_deliveries: Number(merged.total_deliveries || merged.totalDeliveries || 0),
      verified: merged.verified !== false
    };
  }

  function readLocalProfile() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(PUBLIC_STORAGE_KEY);
      return raw ? normaliseProfile(JSON.parse(raw)) : defaultProfile();
    } catch (error) {
      console.warn('Perfil local do motorista inválido:', error);
      return defaultProfile();
    }
  }

  function writeLocalProfile(profile) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
      localStorage.setItem(PUBLIC_STORAGE_KEY, JSON.stringify({
        name: profile.name,
        phone: profile.phone,
        bio: profile.bio,
        avatar_url: profile.avatar_url,
        rating: profile.rating,
        verified: profile.verified,
        total_deliveries: profile.total_deliveries,
        vehicle: {
          type: profile.vehicle_type,
          plate: profile.vehicle_plate,
          brand: profile.vehicle_brand,
          model: profile.vehicle_model,
          color: profile.vehicle_color,
          photo_url: profile.vehicle_photo_url
        }
      }));
      if (profile.name) localStorage.setItem('driverName', profile.name);
      return true;
    } catch (error) {
      console.warn('Não foi possível guardar as fotografias neste dispositivo:', error);
      return false;
    }
  }

  function initials(name) {
    return String(name || 'Motorista')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join('')
      .toUpperCase() || 'M';
  }

  function vehicleTypeLabel(type) {
    return ({ mota: 'Motorizada', carro: 'Carro', carrinha: 'Carrinha', outro: 'Viatura' })[type] || 'Viatura';
  }

  function setText(selector, value) {
    document.querySelectorAll(selector).forEach((element) => {
      element.textContent = value;
    });
  }

  function setImage(image, fallback, source) {
    if (!image) return;
    if (source) {
      image.src = source;
      image.hidden = false;
      if (fallback) fallback.hidden = true;
    } else {
      image.removeAttribute('src');
      image.hidden = true;
      if (fallback) fallback.hidden = false;
    }
  }

  function calculateCompletion(profile) {
    const required = [
      profile.name, profile.phone, profile.email, profile.avatar_url,
      profile.vehicle_type, profile.vehicle_plate, profile.vehicle_brand,
      profile.vehicle_model, profile.vehicle_color, profile.vehicle_photo_url,
      profile.license_number, profile.license_expiry, profile.license_photo_url,
      profile.emergency_name, profile.emergency_phone
    ];
    return Math.round((required.filter(Boolean).length / required.length) * 100);
  }

  function renderProfile(profile = currentProfile) {
    if (!profile) return;
    currentProfile = normaliseProfile(profile);
    const firstLetters = initials(currentProfile.name);
    const typeLabel = vehicleTypeLabel(currentProfile.vehicle_type);

    const verificationLabel = document.querySelector('.driver-verified-label');
    if (verificationLabel) {
      verificationLabel.innerHTML = currentProfile.verified
        ? '<i class="fa-solid fa-shield-halved"></i> MOTORISTA VERIFICADO'
        : '<i class="fa-solid fa-shield"></i> MOTORISTA TRAGO';
    }

    const approvalStatus = currentProfile.approval_status || currentProfile.approvalStatus || (currentProfile.verified ? 'approved' : 'pending');
    const documentStatus = document.querySelector('.driver-document-status');
    if (documentStatus) {
      const statusCopy = {
        approved: ['Aprovado', 'Documentação aprovada pela Administração.', 'fa-circle-check'],
        rejected: ['Rejeitado', 'A documentação precisa de ser corrigida.', 'fa-circle-xmark'],
        pending: ['Pendente', 'Documento pronto para validação pela Administração.', 'fa-clock']
      }[approvalStatus] || ['Pendente', 'Documento pronto para validação pela Administração.', 'fa-clock'];
      documentStatus.dataset.status = approvalStatus;
      const icon = documentStatus.querySelector(':scope > i');
      const description = documentStatus.querySelector('small');
      const badge = documentStatus.querySelector(':scope > b');
      if (icon) icon.className = `fa-solid ${statusCopy[2]}`;
      if (description) description.textContent = statusCopy[1];
      if (badge) badge.textContent = statusCopy[0];
    }

    setText('[data-driver-full-name]', currentProfile.name);
    setText('#driver-profile-rating', currentProfile.rating.toFixed(1));
    setText('#driver-profile-deliveries', `${currentProfile.total_deliveries} entrega${currentProfile.total_deliveries === 1 ? '' : 's'}`);
    setText('#driver-profile-fallback', firstLetters);
    setText('#driver-profile-progress', `${calculateCompletion(currentProfile)}%`);

    const headerName = document.getElementById('driver-name-header');
    if (headerName) headerName.textContent = currentProfile.name;

    setImage(
      document.getElementById('driver-profile-photo'),
      document.getElementById('driver-profile-fallback'),
      currentProfile.avatar_url
    );
    setImage(document.getElementById('driver-vehicle-photo'), null, currentProfile.vehicle_photo_url);
    setImage(document.getElementById('driver-license-photo'), null, currentProfile.license_photo_url);

    const topAvatars = document.querySelectorAll('.v20-driver-app .driver-avatar');
    topAvatars.forEach((avatar) => {
      if (avatar.id === 'driver-profile-fallback') return;
      avatar.textContent = currentProfile.avatar_url ? '' : firstLetters;
      avatar.classList.toggle('has-photo', Boolean(currentProfile.avatar_url));
      avatar.style.backgroundImage = currentProfile.avatar_url ? `url("${currentProfile.avatar_url.replace(/"/g, '%22')}")` : '';
    });

    const form = document.getElementById('driver-profile-form');
    if (form) {
      PROFILE_FIELDS.forEach((field) => {
        const control = form.elements.namedItem(field);
        if (control && document.activeElement !== control) control.value = currentProfile[field] ?? '';
      });
    }
  }

  function profileFromForm() {
    const form = document.getElementById('driver-profile-form');
    if (!form) return currentProfile || defaultProfile();
    const licensePreview = currentProfile?.license_photo_url || '';
    const next = { ...(currentProfile || defaultProfile()), ...pendingImages };
    if (String(pendingImages.license_photo_url || '').startsWith('private:')) {
      next.license_photo_ref = pendingImages.license_photo_url;
      next.license_photo_url = licensePreview;
    }
    PROFILE_FIELDS.forEach((field) => {
      const control = form.elements.namedItem(field);
      if (control) next[field] = String(control.value || '').trim();
    });
    next.vehicle_year = next.vehicle_year ? Number(next.vehicle_year) : '';
    return normaliseProfile(next);
  }

  function showFeedback(title, message, type = 'success') {
    if (typeof window.showCustomAlert === 'function') {
      window.showCustomAlert(title, message, type);
      return;
    }
    window.TragoFeedback?.notify(message, { title, type });
  }

  async function compressImage(file) {
    if (!file || !/^image\/(jpeg|png|webp)$/i.test(file.type)) throw new Error('Escolha uma imagem JPG, PNG ou WEBP.');
    if (file.size > MAX_FILE_SIZE) throw new Error('A fotografia deve ter no máximo 5 MB.');
    if (!window.createImageBitmap) return file;
    const bitmap = await createImageBitmap(file);
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) {
      bitmap.close?.();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Não foi possível comprimir a fotografia.')), 'image/jpeg', 0.86));
    return new File([blob], `${String(file.name || 'fotografia').replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' });
  }

  async function handleImageSelection(kind, input) {
    const fieldMap = {
      avatar: 'avatar_url',
      vehicle: 'vehicle_photo_url',
      license: 'license_photo_url'
    };
    const field = fieldMap[kind];
    const file = input?.files?.[0];
    if (!field || !file) return;

    try {
      document.body.classList.add('driver-photo-processing');
      const uploadFile = await compressImage(file);
      const category = kind === 'vehicle' ? 'vehicle' : kind;
      const form = new FormData();
      form.append('file', uploadFile);
      form.append('category', category);
      const response = await fetch(`${API_URL}/api/media/upload`, {
        method: 'POST',
        headers: getAuthHeaders('driver'),
        body: form
      });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.message || 'Não foi possível carregar a fotografia.');
      pendingImages[field] = data.storage_ref || data.url;
      currentProfile = profileFromForm();
      if (field === 'license_photo_url') {
        currentProfile.license_photo_url = data.url;
        currentProfile.license_photo_ref = data.storage_ref || '';
      }
      renderProfile(currentProfile);
      showFeedback('Fotografia carregada', 'A imagem está pronta. Guarde o perfil para concluir.', 'success');
    } catch (error) {
      showFeedback('Fotografia não adicionada', error.message, 'error');
    } finally {
      document.body.classList.remove('driver-photo-processing');
      if (input) input.value = '';
    }
  }

  async function loadRemoteProfile() {
    try {
      const response = await fetch(`${API_URL}/api/drivers/me/profile`, {
        headers: getAuthHeaders('driver')
      });
      if (!response.ok) return;
      const data = await readJsonResponse(response);
      currentProfile = normaliseProfile(data.driver || data);
      pendingImages = {
        avatar_url: currentProfile.avatar_url,
        vehicle_photo_url: currentProfile.vehicle_photo_url,
        license_photo_url: currentProfile.license_photo_ref || currentProfile.license_photo_url
      };
      writeLocalProfile(currentProfile);
      renderProfile(currentProfile);
    } catch (_error) { /* mantém a cópia local quando o serviço estiver temporariamente indisponível */ }
  }

  async function saveProfile(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const nextProfile = profileFromForm();

    if (!nextProfile.name || !nextProfile.phone || !nextProfile.vehicle_plate) {
      showFeedback('Dados incompletos', 'Preencha o nome, contacto e matrícula da viatura.', 'warning');
      return;
    }

    const locallySaved = writeLocalProfile(nextProfile);
    currentProfile = nextProfile;
    renderProfile(currentProfile);
    if (button) {
      button.disabled = true;
      button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> A guardar…';
    }

    try {
      const response = await fetch(`${API_URL}/api/drivers/me/profile`, {
        method: 'PUT',
        headers: { ...getAuthHeaders('driver'), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...nextProfile,
          license_photo_url: nextProfile.license_photo_ref || pendingImages.license_photo_url || nextProfile.license_photo_url
        })
      });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.message || 'A ligação ao servidor não está disponível.');
      currentProfile = normaliseProfile(data.driver || data);
      pendingImages = {
        avatar_url: currentProfile.avatar_url,
        vehicle_photo_url: currentProfile.vehicle_photo_url,
        license_photo_url: currentProfile.license_photo_ref || currentProfile.license_photo_url
      };
      writeLocalProfile(currentProfile);
      renderProfile(currentProfile);
      showFeedback('Perfil actualizado', 'A sua identificação e a viatura já estão disponíveis para o cliente.', 'success');
    } catch (error) {
      const localMessage = locallySaved
        ? 'Os dados ficaram guardados neste dispositivo e serão sincronizados quando o servidor estiver disponível.'
        : 'Não foi possível guardar o perfil. Reduza o tamanho das fotografias e tente novamente.';
      console.warn('Falha ao sincronizar perfil do motorista:', error);
      showFeedback('Perfil guardado localmente', localMessage, 'warning');
    } finally {
      if (button) {
        button.disabled = false;
        button.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Guardar perfil';
      }
    }
  }

  function attachListeners() {
    const fileInputs = {
      avatar: document.getElementById('driver-avatar-file'),
      vehicle: document.getElementById('driver-vehicle-file'),
      license: document.getElementById('driver-license-file')
    };

    document.querySelectorAll('[data-driver-photo]').forEach((button) => {
      button.addEventListener('click', () => fileInputs[button.dataset.driverPhoto]?.click());
    });
    Object.entries(fileInputs).forEach(([kind, input]) => {
      input?.addEventListener('change', () => handleImageSelection(kind, input));
    });

    const form = document.getElementById('driver-profile-form');
    form?.addEventListener('submit', saveProfile);
    form?.addEventListener('input', () => {
      currentProfile = profileFromForm();
      renderProfile(currentProfile);
    });
  }

  function refresh() {
    renderProfile(currentProfile || readLocalProfile());
    return loadRemoteProfile();
  }

  document.addEventListener('DOMContentLoaded', () => {
    currentProfile = readLocalProfile();
    pendingImages = {
      avatar_url: currentProfile.avatar_url,
      vehicle_photo_url: currentProfile.vehicle_photo_url,
      license_photo_url: currentProfile.license_photo_ref || currentProfile.license_photo_url
    };
    renderProfile(currentProfile);
    attachListeners();
    loadRemoteProfile();
  });

  window.TragoDriverProfile = {
    read: () => ({ ...(currentProfile || readLocalProfile()) }),
    refresh,
    render: renderProfile
  };
}());
