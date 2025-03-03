document.addEventListener("DOMContentLoaded", function () {
    const menuToggle = document.querySelector(".menu-toggle");
    const menu = document.getElementById("menu");

    menuToggle.addEventListener("click", function () {
        if (menu.classList.contains("menu-open")) {
            menu.style.right = "-250px"; // Hide Menu
            menu.classList.remove("menu-open");
        } else {
            menu.style.right = "0"; // Show Menu
            menu.classList.add("menu-open");
        }
    });
});
