# tide's window decoration for KWin 6: `make decoration` builds it, and
# `make install-decoration` installs it (README.md).
cmake_minimum_required(VERSION 3.22)
project(tide-decoration LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

find_package(Qt6 REQUIRED COMPONENTS Core Gui DBus)
find_package(KF6CoreAddons REQUIRED)
find_package(KF6Config REQUIRED)
find_package(KDecoration3 REQUIRED)

add_library(org.tide.decoration MODULE decoration.cpp)
set_target_properties(org.tide.decoration PROPERTIES
    PREFIX ""
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/plugins/org.kde.kdecoration3")
target_compile_options(org.tide.decoration PRIVATE -Wall -Wextra -Werror)
target_link_libraries(org.tide.decoration PRIVATE
    Qt6::Core Qt6::Gui Qt6::DBus
    KF6::CoreAddons KF6::ConfigCore
    KDecoration3::KDecoration)

# Under a Qt plugin directory, which `cmake --install --prefix` names: KWin
# looks for decorations in each one's org.kde.kdecoration3.
install(TARGETS org.tide.decoration LIBRARY DESTINATION org.kde.kdecoration3)
