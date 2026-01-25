document.addEventListener('DOMContentLoaded', () => {
    // Like System
    const likeBtn = document.getElementById('likeBtn');
    if (likeBtn) {
        likeBtn.addEventListener('click', async () => {
            const type = likeBtn.dataset.type;
            const id = likeBtn.dataset.id;

            try {
                const res = await fetch(`/api/like/${type}/${id}`, { method: 'POST' });
                const data = await res.json();

                if (res.ok) {
                    likeBtn.classList.add('text-primary');
                    likeBtn.innerHTML = '<i class="fas fa-heart"></i> Liked';

                    Swal.fire({
                        icon: 'success',
                        title: 'Liked!',
                        text: 'Thanks for displaying your appreciation.',
                        timer: 1500,
                        showConfirmButton: false,
                        position: 'top-end',
                        toast: true
                    });
                } else {
                    Swal.fire({
                        icon: 'info',
                        text: data.error,
                        timer: 2000,
                        showConfirmButton: false,
                        position: 'top-end',
                        toast: true
                    });
                }
            } catch (err) {
                console.error(err);
            }
        });
    }

    // Comment System
    const commentForm = document.getElementById('commentForm');
    if (commentForm) {
        commentForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const type = commentForm.dataset.type;
            const id = commentForm.dataset.id;
            const content = commentForm.querySelector('textarea[name="content"]').value;
            const author = commentForm.querySelector('input[name="author_name"]').value;

            try {
                const res = await fetch(`/api/comment/${type}/${id}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content, author_name: author })
                });
                const data = await res.json();

                if (res.ok) {
                    await Swal.fire({
                        icon: 'success',
                        title: 'Comment Posted',
                        text: 'Your comment has been added successfully.',
                        timer: 1500,
                        showConfirmButton: false
                    });

                    // Reload to show the new comment
                    window.location.reload();
                } else {
                    Swal.fire({
                        icon: 'error',
                        title: 'Oops...',
                        text: data.error || 'Something went wrong!'
                    });
                }
            } catch (err) {
                console.error(err);
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: 'Failed to connect to the server.'
                });
            }
        });
    }
});
